import type { PGlite } from '@electric-sql/pglite';

export type ReportScope = {
  actorRoles: string[];
  storeId?: string;
};

const FINANCE_ROLES = new Set(['owner', 'admin', 'finance']);
const OPS_ROLES = new Set(['owner', 'admin', 'operations', 'finance']);

export function assertCanReadFinance(scope: ReportScope) {
  if (!scope.actorRoles.some((r) => FINANCE_ROLES.has(r))) {
    throw new Error('forbidden_finance_report');
  }
}

export function assertCanReadOps(scope: ReportScope) {
  if (!scope.actorRoles.some((r) => OPS_ROLES.has(r))) {
    throw new Error('forbidden_ops_report');
  }
}

export class ReportService {
  constructor(private readonly db: PGlite) {}

  async dashboardKpis(scope: ReportScope) {
    assertCanReadOps(scope);
    const storeFilter = scope.storeId
      ? await this.db.query<{
          orders: number;
          sales: number;
        }>(
          `SELECT count(*)::int AS orders, coalesce(sum(total_lak),0)::bigint AS sales
           FROM app.child_orders WHERE store_id = $1`,
          [scope.storeId],
        )
      : await this.db.query<{
          orders: number;
          sales: number;
        }>(
          `SELECT count(*)::int AS orders, coalesce(sum(total_lak),0)::bigint AS sales
           FROM app.child_orders`,
        );

    const payments = await this.db.query<{ receipts: number; refunds: number }>(
      `SELECT
         (SELECT coalesce(sum(amount_lak),0)::bigint FROM finance.payment_receipts) AS receipts,
         (SELECT coalesce(sum(amount_lak),0)::bigint FROM finance.payment_refunds WHERE status = 'paid') AS refunds`,
    );
    const settlements = await this.db.query<{ net: number }>(
      `SELECT coalesce(sum(net_lak),0)::bigint AS net FROM finance.settlement_batches WHERE status IN ('approved','paid')`,
    );
    const stock = await this.db.query<{ on_hand: number }>(
      `SELECT coalesce(sum(on_hand),0)::bigint AS on_hand FROM private.inventory_balances`,
    );
    const support = await this.db.query<{ open_tickets: number; breached: number }>(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('closed'))::int AS open_tickets,
         count(*) FILTER (WHERE escalated_at IS NOT NULL)::int AS breached
       FROM app.support_tickets`,
    );
    const quality = await this.db.query<{ suspended: number }>(
      `SELECT count(*)::int AS suspended FROM app.stores WHERE can_accept_orders = false`,
    );

    return {
      source: 'live' as const,
      orders: storeFilter.rows[0]?.orders ?? 0,
      salesLak: Number(storeFilter.rows[0]?.sales ?? 0),
      paymentReceiptsLak: Number(payments.rows[0]?.receipts ?? 0),
      refundsLak: Number(payments.rows[0]?.refunds ?? 0),
      settlementsNetLak: Number(settlements.rows[0]?.net ?? 0),
      stockOnHand: Number(stock.rows[0]?.on_hand ?? 0),
      supportOpen: support.rows[0]?.open_tickets ?? 0,
      supportBreached: support.rows[0]?.breached ?? 0,
      storesSuspended: quality.rows[0]?.suspended ?? 0,
    };
  }

  async reconcilePayments(scope: ReportScope) {
    assertCanReadFinance(scope);
    const rows = await this.db.query<{
      request_id: string;
      request_lak: number;
      alloc_lak: number;
      receipt_lak: number;
    }>(
      `SELECT pr.id AS request_id, pr.amount_lak AS request_lak,
              coalesce((SELECT sum(a.amount_lak) FROM finance.payment_allocations a WHERE a.payment_request_id = pr.id),0) AS alloc_lak,
              coalesce((
                SELECT sum(r.amount_lak) FROM finance.payment_receipts r
                JOIN finance.payment_attempts at ON at.id = r.payment_attempt_id
                WHERE at.payment_request_id = pr.id AND at.status = 'confirmed'
              ),0) AS receipt_lak
       FROM finance.payment_requests pr`,
    );
    const mismatches = rows.rows.filter(
      (r) =>
        Number(r.request_lak) !== Number(r.alloc_lak) ||
        (Number(r.receipt_lak) > 0 &&
          Number(r.receipt_lak) !== Number(r.request_lak) &&
          Number(r.receipt_lak) < Number(r.request_lak)),
    );
    return {
      totalRequests: rows.rows.length,
      mismatchCount: mismatches.length,
      ok: mismatches.length === 0,
    };
  }
}
