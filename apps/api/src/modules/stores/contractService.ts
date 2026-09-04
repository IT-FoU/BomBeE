import type { PGlite } from '@electric-sql/pglite';

export type RevenueModel = 'markup' | 'commission' | 'per_order_fee' | 'mixed';
export type SettlementCadence = 'daily' | 'weekly' | 'monthly' | 'custom';

export type ContractTerms = {
  revenueModel: RevenueModel;
  markupBps?: number;
  commissionBps?: number;
  perOrderFeeLak?: number;
  settlementCadence: SettlementCadence;
  customCadenceDays?: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

export function resolveContractForOrderTime(
  versions: Array<ContractTerms & { id: string }>,
  orderCreatedAt: string,
): (ContractTerms & { id: string }) | null {
  const t = Date.parse(orderCreatedAt);
  const applicable = versions
    .filter((v) => {
      const from = Date.parse(v.effectiveFrom);
      const to = v.effectiveTo ? Date.parse(v.effectiveTo) : Number.POSITIVE_INFINITY;
      return t >= from && t < to;
    })
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  return applicable[0] ?? null;
}

export class ContractService {
  constructor(private readonly db: PGlite) {}

  async createVersion(input: {
    storeId: string;
    terms: ContractTerms;
    createdBy?: string;
  }) {
    const latest = await this.db.query<{ version_no: number }>(
      `SELECT version_no FROM finance.store_contract_versions
       WHERE store_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [input.storeId],
    );
    const versionNo = (latest.rows[0]?.version_no ?? 0) + 1;
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.store_contract_versions
        (store_id, version_no, revenue_model, markup_bps, commission_bps,
         per_order_fee_lak, settlement_cadence, custom_cadence_days,
         effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        input.storeId,
        versionNo,
        input.terms.revenueModel,
        input.terms.markupBps ?? null,
        input.terms.commissionBps ?? null,
        input.terms.perOrderFeeLak ?? null,
        input.terms.settlementCadence,
        input.terms.customCadenceDays ?? null,
        input.terms.effectiveFrom,
        input.terms.effectiveTo ?? null,
        input.createdBy ?? null,
      ],
    );
    return { id: row.rows[0]!.id, versionNo };
  }

  async snapshotForChildOrder(input: {
    childOrderId: string;
    storeId: string;
    orderCreatedAt: string;
  }) {
    const versions = await this.db.query<{
      id: string;
      revenue_model: RevenueModel;
      markup_bps: number | null;
      commission_bps: number | null;
      per_order_fee_lak: number | null;
      settlement_cadence: SettlementCadence;
      custom_cadence_days: number | null;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, revenue_model, markup_bps, commission_bps, per_order_fee_lak,
              settlement_cadence, custom_cadence_days,
              effective_from::text, effective_to::text
       FROM finance.store_contract_versions WHERE store_id = $1`,
      [input.storeId],
    );

    const mapped = versions.rows.map((v) => ({
      id: v.id,
      revenueModel: v.revenue_model,
      markupBps: v.markup_bps ?? undefined,
      commissionBps: v.commission_bps ?? undefined,
      perOrderFeeLak: v.per_order_fee_lak ?? undefined,
      settlementCadence: v.settlement_cadence,
      customCadenceDays: v.custom_cadence_days ?? undefined,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to ?? undefined,
    }));

    const selected = resolveContractForOrderTime(mapped, input.orderCreatedAt);
    if (!selected) throw new Error('no_effective_contract');

    await this.db.query(
      `INSERT INTO finance.order_contract_snapshots
        (child_order_id, store_id, contract_version_id, revenue_model,
         markup_bps, commission_bps, per_order_fee_lak, settlement_cadence, custom_cadence_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.childOrderId,
        input.storeId,
        selected.id,
        selected.revenueModel,
        selected.markupBps ?? null,
        selected.commissionBps ?? null,
        selected.perOrderFeeLak ?? null,
        selected.settlementCadence,
        selected.customCadenceDays ?? null,
      ],
    );

    return selected;
  }

  async tryMutateContract(versionId: string): Promise<boolean> {
    try {
      await this.db.query(
        `UPDATE finance.store_contract_versions SET markup_bps = 1 WHERE id = $1`,
        [versionId],
      );
      return false;
    } catch {
      return true;
    }
  }

  async listVersions(input: { storeId?: string; limit?: number } = {}) {
    const capped = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const rows = await this.db.query<{
      id: string;
      store_id: string;
      version_no: number;
      revenue_model: RevenueModel;
      markup_bps: number | null;
      commission_bps: number | null;
      per_order_fee_lak: number | null;
      settlement_cadence: SettlementCadence;
      custom_cadence_days: number | null;
      effective_from: string;
      effective_to: string | null;
      created_at: string;
      created_by: string | null;
    }>(
      input.storeId
        ? `SELECT id, store_id, version_no, revenue_model, markup_bps, commission_bps,
                  per_order_fee_lak, settlement_cadence, custom_cadence_days,
                  effective_from::text, effective_to::text, created_at::text, created_by
           FROM finance.store_contract_versions
           WHERE store_id = $1
           ORDER BY version_no DESC
           LIMIT $2`
        : `SELECT id, store_id, version_no, revenue_model, markup_bps, commission_bps,
                  per_order_fee_lak, settlement_cadence, custom_cadence_days,
                  effective_from::text, effective_to::text, created_at::text, created_by
           FROM finance.store_contract_versions
           ORDER BY created_at DESC
           LIMIT $1`,
      input.storeId ? [input.storeId, capped] : [capped],
    );
    return rows.rows.map((r) => ({
      contractId: r.id,
      storeId: r.store_id,
      versionNo: r.version_no,
      revenueModel: r.revenue_model,
      markupBps: r.markup_bps,
      commissionBps: r.commission_bps,
      perOrderFeeLak: r.per_order_fee_lak,
      settlementCadence: r.settlement_cadence,
      customCadenceDays: r.custom_cadence_days,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
  }
}
