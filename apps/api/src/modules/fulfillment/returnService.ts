import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import {
  assertReturnEligible,
  refundSlaDueAt,
  type ReturnReason,
} from './rules.js';

export class ReturnService {
  constructor(
    private readonly db: PGlite,
    private readonly audit = new AuditService(db),
  ) {}

  async requestReturn(input: {
    childOrderId: string;
    reason: ReturnReason;
    deliveredAt: Date;
    requestedAt?: Date;
    evidenceKeys?: string[];
    createdBy?: string;
  }) {
    const requestedAt = input.requestedAt ?? new Date();
    const check = assertReturnEligible({
      reason: input.reason,
      deliveredAt: input.deliveredAt,
      requestedAt,
    });
    if (!check.ok) throw new Error(check.reason);

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.return_requests
        (child_order_id, reason, delivered_at, requested_at, shipping_liability,
         evidence_keys, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
      [
        input.childOrderId,
        input.reason,
        input.deliveredAt.toISOString(),
        requestedAt.toISOString(),
        check.shippingLiability,
        input.evidenceKeys ?? [],
        input.createdBy ?? null,
      ],
    );
    await this.db.query(
      `UPDATE app.child_orders SET status = 'return_requested', updated_at = timezone('utc', now())
       WHERE id = $1`,
      [input.childOrderId],
    );
    await this.audit.append({
      actorIdentityId: input.createdBy,
      actorType: input.createdBy ? 'customer' : 'system',
      action: 'return.requested',
      targetType: 'return_request',
      targetId: row.rows[0]!.id,
      afterState: { reason: input.reason, liability: check.shippingLiability },
      correlationId: crypto.randomUUID(),
    });
    return {
      returnRequestId: row.rows[0]!.id,
      shippingLiability: check.shippingLiability,
    };
  }

  async appendCommunication(returnRequestId: string, message: Record<string, unknown>) {
    await this.db.query(
      `UPDATE app.return_requests
       SET communications = communications || $2::jsonb
       WHERE id = $1`,
      [returnRequestId, JSON.stringify([message])],
    );
  }

  async createRefundRequest(input: {
    childOrderId: string;
    amountLak: number;
    reason: string;
    makerIdentityId: string;
  }) {
    const refund = await this.db.query<{ id: string }>(
      `INSERT INTO app.refund_requests (child_order_id, amount_lak, reason, status)
       VALUES ($1,$2,$3,'pending') RETURNING id`,
      [input.childOrderId, input.amountLak, input.reason],
    );
    const approval = await this.db.query<{ id: string }>(
      `INSERT INTO app.refund_approvals
        (refund_request_id, amount_lak, maker_identity_id, status)
       VALUES ($1,$2,$3,'pending') RETURNING id`,
      [refund.rows[0]!.id, input.amountLak, input.makerIdentityId],
    );
    return {
      refundRequestId: refund.rows[0]!.id,
      approvalId: approval.rows[0]!.id,
    };
  }

  async approveRefund(input: {
    approvalId: string;
    approverIdentityId: string;
    approvedAt?: Date;
  }) {
    const row = await this.db.query<{
      maker_identity_id: string;
      amount_lak: number;
      refund_request_id: string;
      status: string;
    }>(`SELECT maker_identity_id, amount_lak, refund_request_id, status
        FROM app.refund_approvals WHERE id = $1`, [input.approvalId]);
    if (!row.rows[0]) throw new Error('refund_approval_not_found');
    if (row.rows[0].status !== 'pending') throw new Error('refund_not_pending');
    if (row.rows[0].maker_identity_id === input.approverIdentityId) {
      throw new Error('self_approval_denied');
    }
    const approvedAt = input.approvedAt ?? new Date();
    const slaDue = refundSlaDueAt(approvedAt);
    await this.db.query(
      `UPDATE app.refund_approvals
       SET status = 'approved', approver_identity_id = $2, approved_at = $3, sla_due_at = $4
       WHERE id = $1`,
      [
        input.approvalId,
        input.approverIdentityId,
        approvedAt.toISOString(),
        slaDue.toISOString(),
      ],
    );
    await this.db.query(
      `UPDATE app.refund_requests SET status = 'approved' WHERE id = $1`,
      [row.rows[0].refund_request_id],
    );
    await this.audit.append({
      actorIdentityId: input.approverIdentityId,
      actorType: 'staff',
      action: 'refund.approved',
      targetType: 'refund_approval',
      targetId: input.approvalId,
      afterState: { slaDueAt: slaDue.toISOString() },
      correlationId: crypto.randomUUID(),
    });
    return { slaDueAt: slaDue.toISOString() };
  }

  async payRefundViaLedger(input: {
    approvalId: string;
    paymentRequestId: string;
    paidAt?: Date;
  }) {
    const approval = await this.db.query<{
      status: string;
      amount_lak: number;
      refund_request_id: string;
      sla_due_at: string | null;
    }>(
      `SELECT status, amount_lak, refund_request_id, sla_due_at
       FROM app.refund_approvals WHERE id = $1`,
      [input.approvalId],
    );
    if (!approval.rows[0] || approval.rows[0].status !== 'approved') {
      throw new Error('refund_not_approved');
    }
    const paidAt = input.paidAt ?? new Date();
    const ledger = await this.db.query<{ id: string }>(
      `INSERT INTO finance.payment_refunds
        (payment_request_id, amount_lak, reason, status)
       VALUES ($1,$2,'other','paid') RETURNING id`,
      [input.paymentRequestId, approval.rows[0].amount_lak],
    );
    await this.db.query(
      `UPDATE app.refund_approvals
       SET status = 'paid', paid_at = $2, payment_refund_id = $3
       WHERE id = $1`,
      [input.approvalId, paidAt.toISOString(), ledger.rows[0]!.id],
    );
    await this.db.query(
      `UPDATE app.refund_requests SET status = 'paid' WHERE id = $1`,
      [approval.rows[0].refund_request_id],
    );
    const withinSla =
      !approval.rows[0].sla_due_at ||
      paidAt.getTime() <= Date.parse(approval.rows[0].sla_due_at);
    return { paymentRefundId: ledger.rows[0]!.id, withinSla };
  }
}
