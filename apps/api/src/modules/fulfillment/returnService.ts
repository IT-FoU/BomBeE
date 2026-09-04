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

  async listReturns(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      child_order_id: string;
      parent_order_id: string;
      reason: string;
      status: string;
      shipping_liability: string | null;
      total_lak: number;
      requested_at: string;
      delivered_at: string;
    }>(
      `SELECT r.id, r.child_order_id, co.parent_order_id, r.reason, r.status,
              r.shipping_liability, co.total_lak,
              r.requested_at::text, r.delivered_at::text
       FROM app.return_requests r
       JOIN app.child_orders co ON co.id = r.child_order_id
       ORDER BY r.requested_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      returnRequestId: r.id,
      childOrderId: r.child_order_id,
      parentOrderId: r.parent_order_id,
      reason: r.reason,
      status: r.status,
      shippingLiability: r.shipping_liability,
      amountLak: Number(r.total_lak),
      requestedAt: r.requested_at,
      deliveredAt: r.delivered_at,
    }));
  }

  async listReturnsForCustomer(customerIdentityId: string, limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      child_order_id: string;
      parent_order_id: string;
      reason: string;
      status: string;
      shipping_liability: string | null;
      total_lak: number;
      requested_at: string;
      delivered_at: string;
    }>(
      `SELECT r.id, r.child_order_id, co.parent_order_id, r.reason, r.status,
              r.shipping_liability, co.total_lak,
              r.requested_at::text, r.delivered_at::text
       FROM app.return_requests r
       JOIN app.child_orders co ON co.id = r.child_order_id
       JOIN app.parent_orders po ON po.id = co.parent_order_id
       WHERE po.customer_identity_id = $1
       ORDER BY r.requested_at DESC
       LIMIT $2`,
      [customerIdentityId, capped],
    );
    return rows.rows.map((r) => ({
      returnRequestId: r.id,
      childOrderId: r.child_order_id,
      parentOrderId: r.parent_order_id,
      reason: r.reason,
      status: r.status,
      shippingLiability: r.shipping_liability,
      amountLak: Number(r.total_lak),
      requestedAt: r.requested_at,
      deliveredAt: r.delivered_at,
    }));
  }

  async resolveOwnedDeliveredChild(input: {
    childOrderId: string;
    customerIdentityId: string;
  }) {
    const delivery = await this.db.query<{
      delivered_at: string | null;
      status: string;
      customer_identity_id: string;
    }>(
      `SELECT sd.delivered_at::text, co.status, po.customer_identity_id
       FROM app.child_orders co
       JOIN app.parent_orders po ON po.id = co.parent_order_id
       LEFT JOIN app.shipment_deliveries sd
         ON sd.child_order_id = co.id AND sd.status = 'delivered'
       WHERE co.id = $1
       ORDER BY sd.delivered_at DESC NULLS LAST
       LIMIT 1`,
      [input.childOrderId],
    );
    const child = delivery.rows[0];
    if (!child) throw new Error('child_order_not_found');
    if (child.customer_identity_id !== input.customerIdentityId) {
      throw new Error('not_order_owner');
    }
    if (child.status !== 'delivered' || !child.delivered_at) {
      throw new Error('child_not_delivered');
    }
    return { deliveredAt: new Date(child.delivered_at) };
  }

  async approveReturn(returnRequestId: string) {
    const row = await this.db.query<{ status: string }>(
      `SELECT status FROM app.return_requests WHERE id = $1`,
      [returnRequestId],
    );
    if (!row.rows[0]) throw new Error('return_not_found');
    if (row.rows[0].status !== 'pending') throw new Error('return_not_pending');
    await this.db.query(
      `UPDATE app.return_requests SET status = 'approved' WHERE id = $1`,
      [returnRequestId],
    );
  }

  async listRefundApprovals(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      approval_id: string;
      refund_request_id: string;
      child_order_id: string;
      parent_order_id: string;
      amount_lak: number;
      reason: string;
      status: string;
      sla_due_at: string | null;
    }>(
      `SELECT a.id AS approval_id, a.refund_request_id, r.child_order_id, co.parent_order_id,
              a.amount_lak, r.reason, a.status, a.sla_due_at::text
       FROM app.refund_approvals a
       JOIN app.refund_requests r ON r.id = a.refund_request_id
       JOIN app.child_orders co ON co.id = r.child_order_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      approvalId: r.approval_id,
      refundRequestId: r.refund_request_id,
      childOrderId: r.child_order_id,
      parentOrderId: r.parent_order_id,
      amountLak: Number(r.amount_lak),
      reason: r.reason,
      status: r.status,
      slaDueAt: r.sla_due_at,
    }));
  }
}
