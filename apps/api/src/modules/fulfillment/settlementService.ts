import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import { isWithinDisputeWindow, settlementEligible } from './rules.js';

export class SettlementService {
  constructor(
    private readonly db: PGlite,
    private readonly audit = new AuditService(db),
  ) {}

  async listEligibleChildOrders(storeId: string) {
    const rows = await this.db.query<{
      id: string;
      total_lak: number;
      payment_received: boolean;
      status: string;
      cadence: string | null;
      payment_request_id: string | null;
      return_hold: boolean;
    }>(
      `SELECT co.id, co.total_lak, co.payment_received, co.status,
              ocs.settlement_cadence AS cadence,
              (
                SELECT pa.payment_request_id
                FROM finance.payment_allocations pa
                JOIN finance.payment_requests pr ON pr.id = pa.payment_request_id
                WHERE pa.child_order_id = co.id AND pr.status IN ('paid','partially_paid')
                ORDER BY pr.created_at DESC LIMIT 1
              ) AS payment_request_id,
              EXISTS (
                SELECT 1 FROM app.return_requests rr
                WHERE rr.child_order_id = co.id AND rr.status IN ('pending','approved')
              ) AS return_hold
       FROM app.child_orders co
       LEFT JOIN finance.order_contract_snapshots ocs ON ocs.child_order_id = co.id
       WHERE co.store_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM finance.settlement_lines sl WHERE sl.child_order_id = co.id
         )`,
      [storeId],
    );
    return rows.rows
      .filter((r) =>
        settlementEligible({
          childStatus: r.status,
          paymentReceived: r.payment_received,
          returnHold: r.return_hold,
        }),
      )
      .map((r) => ({
        childOrderId: r.id,
        amountLak: Number(r.total_lak),
        cadence: r.cadence ?? 'weekly',
        paymentRequestId: r.payment_request_id,
      }));
  }

  async listBatches(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      store_id: string;
      store_name: string;
      status: string;
      cadence: string;
      gross_lak: number;
      net_lak: number;
      held_lak: number;
      line_count: number;
      period_start: string;
      period_end: string;
      created_at: string;
    }>(
      `SELECT b.id, b.store_id, s.name AS store_name, b.status, b.cadence,
              b.gross_lak, b.net_lak, b.held_lak,
              (SELECT count(*)::int FROM finance.settlement_lines l WHERE l.batch_id = b.id) AS line_count,
              b.period_start::text, b.period_end::text, b.created_at::text
       FROM finance.settlement_batches b
       JOIN app.stores s ON s.id = b.store_id
       ORDER BY b.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      batchId: r.id,
      storeId: r.store_id,
      storeName: r.store_name,
      status: r.status,
      cadence: r.cadence,
      grossLak: Number(r.gross_lak),
      netLak: Number(r.net_lak),
      heldLak: Number(r.held_lak),
      lineCount: Number(r.line_count),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      createdAt: r.created_at,
    }));
  }

  async listLines(batchId: string) {
    const rows = await this.db.query<{
      id: string;
      child_order_id: string;
      amount_lak: number;
      held: boolean;
      disputed: boolean;
      hold_reason: string | null;
    }>(
      `SELECT id, child_order_id, amount_lak, held, disputed, hold_reason
       FROM finance.settlement_lines
       WHERE batch_id = $1
       ORDER BY child_order_id`,
      [batchId],
    );
    return rows.rows.map((r) => ({
      lineId: r.id,
      childOrderId: r.child_order_id,
      amountLak: Number(r.amount_lak),
      held: r.held,
      disputed: r.disputed,
      holdReason: r.hold_reason,
    }));
  }

  async createBatch(input: {
    storeId: string;
    makerIdentityId: string;
    periodStart: Date;
    periodEnd: Date;
    cadence?: string;
  }) {
    const eligible = await this.listEligibleChildOrders(input.storeId);
    const cadence = input.cadence ?? eligible[0]?.cadence ?? 'weekly';
    const carry = await this.db.query<{ amount_lak: number }>(
      `SELECT coalesce(sum(amount_lak),0)::bigint AS amount_lak
       FROM finance.store_balance_carryforward
       WHERE store_id = $1 AND status = 'open'`,
      [input.storeId],
    );
    const carryLak = Number(carry.rows[0]?.amount_lak ?? 0);

    const payout = await this.db.query<{ id: string; payout_hold_until: string | null }>(
      `SELECT id, payout_hold_until FROM finance.payout_account_versions
       WHERE store_id = $1 AND status = 'active' LIMIT 1`,
      [input.storeId],
    );
    if (!payout.rows[0]) throw new Error('active_payout_account_required');
    if (
      payout.rows[0].payout_hold_until &&
      Date.parse(payout.rows[0].payout_hold_until) > Date.now()
    ) {
      throw new Error('payout_account_on_hold');
    }

    const gross = eligible.reduce((s, e) => s + e.amountLak, 0);
    const net = gross + carryLak;
    const batch = await this.db.query<{ id: string }>(
      `INSERT INTO finance.settlement_batches
        (store_id, cadence, period_start, period_end, status, maker_identity_id,
         payout_account_version_id, gross_lak, held_lak, net_lak, carry_forward_lak)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,0,$8,$9) RETURNING id`,
      [
        input.storeId,
        cadence,
        input.periodStart.toISOString(),
        input.periodEnd.toISOString(),
        input.makerIdentityId,
        payout.rows[0].id,
        gross,
        net,
        carryLak,
      ],
    );
    for (const line of eligible) {
      await this.db.query(
        `INSERT INTO finance.settlement_lines
          (batch_id, child_order_id, payment_request_id, amount_lak, held)
         VALUES ($1,$2,$3,$4,false)`,
        [batch.rows[0]!.id, line.childOrderId, line.paymentRequestId, line.amountLak],
      );
    }
    return {
      batchId: batch.rows[0]!.id,
      grossLak: gross,
      netLak: net,
      lineCount: eligible.length,
      payoutAccountVersionId: payout.rows[0].id,
    };
  }

  async holdLine(input: {
    batchId: string;
    childOrderId: string;
    reason: string;
  }) {
    await this.db.query(
      `UPDATE finance.settlement_lines
       SET held = true, hold_reason = $3
       WHERE batch_id = $1 AND child_order_id = $2`,
      [input.batchId, input.childOrderId, input.reason],
    );
    await this.recomputeBatchTotals(input.batchId);
  }

  async submitForApproval(batchId: string) {
    const batch = await this.db.query<{ status: string }>(
      `SELECT status FROM finance.settlement_batches WHERE id = $1`,
      [batchId],
    );
    if (!batch.rows[0]) throw new Error('batch_not_found');
    if (batch.rows[0].status !== 'draft') {
      throw new Error('batch_not_submittable');
    }
    await this.db.query(
      `UPDATE finance.settlement_batches SET status = 'pending_approval' WHERE id = $1`,
      [batchId],
    );
  }

  async approveBatch(input: {
    batchId: string;
    approverIdentityId: string;
  }) {
    const batch = await this.db.query<{
      maker_identity_id: string;
      status: string;
    }>(`SELECT maker_identity_id, status FROM finance.settlement_batches WHERE id = $1`, [
      input.batchId,
    ]);
    if (!batch.rows[0]) throw new Error('batch_not_found');
    if (batch.rows[0].status !== 'pending_approval' && batch.rows[0].status !== 'draft') {
      throw new Error('batch_not_approvable');
    }
    if (batch.rows[0].maker_identity_id === input.approverIdentityId) {
      throw new Error('self_approval_denied');
    }
    await this.db.query(
      `UPDATE finance.settlement_batches
       SET status = 'approved', approver_identity_id = $2, approved_at = timezone('utc', now())
       WHERE id = $1`,
      [input.batchId, input.approverIdentityId],
    );
    await this.db.query(
      `UPDATE finance.store_balance_carryforward
       SET status = 'applied'
       WHERE store_id = (SELECT store_id FROM finance.settlement_batches WHERE id = $1)
         AND status = 'open'`,
      [input.batchId],
    );
    await this.audit.append({
      actorIdentityId: input.approverIdentityId,
      actorType: 'staff',
      action: 'settlement.approved',
      targetType: 'settlement_batch',
      targetId: input.batchId,
      correlationId: crypto.randomUUID(),
    });
  }

  async openDispute(input: {
    batchId: string;
    childOrderId: string;
    reason: string;
    now?: Date;
  }) {
    const batch = await this.db.query<{
      created_at: string;
      store_id: string;
    }>(`SELECT created_at, store_id FROM finance.settlement_batches WHERE id = $1`, [
      input.batchId,
    ]);
    if (!batch.rows[0]) throw new Error('batch_not_found');
    const now = input.now ?? new Date();
    if (!isWithinDisputeWindow(new Date(batch.rows[0].created_at), now)) {
      throw new Error('dispute_window_exceeded');
    }
    const line = await this.db.query<{ id: string }>(
      `SELECT id FROM finance.settlement_lines
       WHERE batch_id = $1 AND child_order_id = $2`,
      [input.batchId, input.childOrderId],
    );
    if (!line.rows[0]) throw new Error('settlement_line_not_found');
    await this.db.query(
      `UPDATE finance.settlement_lines SET disputed = true, held = true, hold_reason = 'dispute'
       WHERE id = $1`,
      [line.rows[0].id],
    );
    const dispute = await this.db.query<{ id: string }>(
      `INSERT INTO finance.settlement_disputes
        (batch_id, settlement_line_id, store_id, reason)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.batchId, line.rows[0].id, batch.rows[0].store_id, input.reason],
    );
    await this.db.query(
      `UPDATE finance.settlement_batches SET status = 'partially_disputed' WHERE id = $1`,
      [input.batchId],
    );
    await this.recomputeBatchTotals(input.batchId);
    return { disputeId: dispute.rows[0]!.id };
  }

  async recordNegativeCarryForward(input: {
    storeId: string;
    amountLak: number;
    sourceBatchId?: string;
    collect?: boolean;
  }) {
    if (input.amountLak >= 0) throw new Error('carryforward_must_be_negative');
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.store_balance_carryforward
        (store_id, amount_lak, source_batch_id, status)
       VALUES ($1,$2,$3,'open') RETURNING id`,
      [input.storeId, input.amountLak, input.sourceBatchId ?? null],
    );
    let collectionRequestId: string | undefined;
    if (input.collect) {
      const col = await this.db.query<{ id: string }>(
        `INSERT INTO finance.collection_requests
          (store_id, amount_lak, carryforward_id)
         VALUES ($1,$2,$3) RETURNING id`,
        [input.storeId, Math.abs(input.amountLak), row.rows[0]!.id],
      );
      collectionRequestId = col.rows[0]!.id;
    }
    return { carryforwardId: row.rows[0]!.id, collectionRequestId };
  }

  private async recomputeBatchTotals(batchId: string) {
    const totals = await this.db.query<{
      gross: number;
      held: number;
    }>(
      `SELECT
         coalesce(sum(CASE WHEN NOT held THEN amount_lak ELSE 0 END),0)::bigint AS gross,
         coalesce(sum(CASE WHEN held THEN amount_lak ELSE 0 END),0)::bigint AS held
       FROM finance.settlement_lines WHERE batch_id = $1`,
      [batchId],
    );
    const carry = await this.db.query<{ carry_forward_lak: number }>(
      `SELECT carry_forward_lak FROM finance.settlement_batches WHERE id = $1`,
      [batchId],
    );
    const gross = Number(totals.rows[0]?.gross ?? 0);
    const held = Number(totals.rows[0]?.held ?? 0);
    const carryLak = Number(carry.rows[0]?.carry_forward_lak ?? 0);
    await this.db.query(
      `UPDATE finance.settlement_batches
       SET gross_lak = $2::bigint, held_lak = $3::bigint, net_lak = ($2::bigint + $4::bigint)
       WHERE id = $1`,
      [batchId, gross, held, carryLak],
    );
  }
}
