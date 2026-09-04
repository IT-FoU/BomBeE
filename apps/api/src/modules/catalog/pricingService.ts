import type { PGlite } from '@electric-sql/pglite';

import { isBelowCost, marginLak } from './rules.js';

export class PricingService {
  constructor(private readonly db: PGlite) {}

  async proposePrice(input: {
    variantId: string;
    costLak: number;
    sellingPriceLak: number;
    compareAtPriceLak?: number;
    reason?: string;
    makerIdentityId: string;
  }) {
    const belowCost = isBelowCost(input.sellingPriceLak, input.costLak);
    const margin = marginLak(input.sellingPriceLak, input.costLak);
    if (belowCost && (!input.reason || input.reason.trim().length < 8)) {
      throw new Error('below_cost_reason_required');
    }

    const latest = await this.db.query<{ version_no: number }>(
      `SELECT version_no FROM finance.price_versions
       WHERE variant_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [input.variantId],
    );
    const versionNo = (latest.rows[0]?.version_no ?? 0) + 1;

    const version = await this.db.query<{ id: string }>(
      `INSERT INTO finance.price_versions
        (variant_id, version_no, cost_lak, selling_price_lak, compare_at_price_lak,
         margin_lak, status, below_cost, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)
       RETURNING id`,
      [
        input.variantId,
        versionNo,
        input.costLak,
        input.sellingPriceLak,
        input.compareAtPriceLak ?? null,
        margin,
        belowCost,
        input.reason ?? null,
        input.makerIdentityId,
      ],
    );
    const priceVersionId = version.rows[0]!.id;

    const request = await this.db.query<{ id: string }>(
      `INSERT INTO finance.price_change_requests
        (price_version_id, maker_identity_id, requires_owner, requires_2fa)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [priceVersionId, input.makerIdentityId, belowCost, belowCost],
    );

    return {
      priceVersionId,
      requestId: request.rows[0]!.id,
      belowCost,
      status: 'pending' as const,
    };
  }

  async approvePrice(input: {
    requestId: string;
    approverIdentityId: string;
    actorRoles: string[];
    stepUpVerified: boolean;
  }) {
    const req = await this.db.query<{
      id: string;
      price_version_id: string;
      maker_identity_id: string;
      status: string;
      requires_owner: boolean;
      requires_2fa: boolean;
    }>(
      `SELECT id, price_version_id, maker_identity_id, status, requires_owner, requires_2fa
       FROM finance.price_change_requests WHERE id = $1`,
      [input.requestId],
    );
    const current = req.rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' };
    if (current.status !== 'pending') return { ok: false as const, reason: 'not_pending' };
    if (current.maker_identity_id === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }
    if (current.requires_owner && !input.actorRoles.includes('owner')) {
      return { ok: false as const, reason: 'owner_required' };
    }
    if (current.requires_2fa && !input.stepUpVerified) {
      return { ok: false as const, reason: '2fa_required' };
    }
    if (
      !current.requires_owner &&
      !input.actorRoles.includes('owner') &&
      !input.actorRoles.includes('admin') &&
      !input.actorRoles.includes('catalog')
    ) {
      return { ok: false as const, reason: 'not_authorized' };
    }

    const version = await this.db.query<{ variant_id: string }>(
      `SELECT variant_id FROM finance.price_versions WHERE id = $1`,
      [current.price_version_id],
    );
    const variantId = version.rows[0]!.variant_id;

    await this.db.query(
      `UPDATE finance.price_versions SET status = 'superseded'
       WHERE variant_id = $1 AND status = 'approved'`,
      [variantId],
    );
    await this.db.query(
      `UPDATE finance.price_versions
       SET status = 'approved', approved_by = $2, approved_at = timezone('utc', now())
       WHERE id = $1`,
      [current.price_version_id, input.approverIdentityId],
    );
    await this.db.query(
      `UPDATE finance.price_change_requests
       SET status = 'approved', approver_identity_id = $2,
           step_up_verified_at = CASE WHEN $3 THEN timezone('utc', now()) ELSE NULL END,
           decided_at = timezone('utc', now())
       WHERE id = $1`,
      [current.id, input.approverIdentityId, input.stepUpVerified],
    );

    return { ok: true as const, priceVersionId: current.price_version_id };
  }

  async activePrice(variantId: string) {
    const row = await this.db.query<{
      id: string;
      selling_price_lak: number;
      cost_lak: number;
      status: string;
    }>(
      `SELECT id, selling_price_lak, cost_lak, status
       FROM finance.price_versions
       WHERE variant_id = $1 AND status = 'approved'
       LIMIT 1`,
      [variantId],
    );
    return row.rows[0] ?? null;
  }

  async requestNearExpiryDiscount(input: {
    variantId: string;
    proposedSellingPriceLak: number;
    reason: string;
    makerIdentityId: string;
  }) {
    if (input.reason.trim().length < 8) throw new Error('reason_required');
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.near_expiry_discount_requests
        (variant_id, proposed_selling_price_lak, reason, maker_identity_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [
        input.variantId,
        input.proposedSellingPriceLak,
        input.reason,
        input.makerIdentityId,
      ],
    );
    return row.rows[0]!.id;
  }

  async approveNearExpiryDiscount(input: {
    requestId: string;
    approverIdentityId: string;
  }) {
    const req = await this.db.query<{
      id: string;
      maker_identity_id: string;
      status: string;
      variant_id: string;
      proposed_selling_price_lak: number;
    }>(
      `SELECT id, maker_identity_id, status, variant_id, proposed_selling_price_lak
       FROM finance.near_expiry_discount_requests WHERE id = $1`,
      [input.requestId],
    );
    const current = req.rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' };
    if (current.status !== 'pending') return { ok: false as const, reason: 'not_pending' };
    if (current.maker_identity_id === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }
    await this.db.query(
      `UPDATE finance.near_expiry_discount_requests
       SET status = 'approved', approver_identity_id = $2,
           decided_at = timezone('utc', now())
       WHERE id = $1`,
      [current.id, input.approverIdentityId],
    );
    return {
      ok: true as const,
      requestId: current.id,
      variantId: current.variant_id,
      proposedSellingPriceLak: Number(current.proposed_selling_price_lak),
    };
  }

  async listNearExpiryDiscounts(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      variant_id: string;
      proposed_selling_price_lak: number;
      reason: string;
      status: string;
      maker_identity_id: string;
      approver_identity_id: string | null;
      created_at: string;
      decided_at: string | null;
    }>(
      `SELECT id, variant_id, proposed_selling_price_lak, reason, status,
              maker_identity_id, approver_identity_id,
              created_at::text, decided_at::text
       FROM finance.near_expiry_discount_requests
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      requestId: r.id,
      variantId: r.variant_id,
      proposedSellingPriceLak: Number(r.proposed_selling_price_lak),
      reason: r.reason,
      status: r.status,
      makerIdentityId: r.maker_identity_id,
      approverIdentityId: r.approver_identity_id,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
  }

  async listPriceRequests(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      price_version_id: string;
      variant_id: string;
      cost_lak: number;
      selling_price_lak: number;
      margin_lak: number;
      below_cost: boolean;
      version_status: string;
      request_status: string;
      maker_identity_id: string;
      approver_identity_id: string | null;
      requires_owner: boolean;
      requires_2fa: boolean;
      reason: string | null;
      created_at: string;
      decided_at: string | null;
    }>(
      `SELECT r.id, r.price_version_id, v.variant_id, v.cost_lak, v.selling_price_lak,
              v.margin_lak, v.below_cost, v.status AS version_status, r.status AS request_status,
              r.maker_identity_id, r.approver_identity_id, r.requires_owner, r.requires_2fa,
              v.reason, r.created_at::text, r.decided_at::text
       FROM finance.price_change_requests r
       JOIN finance.price_versions v ON v.id = r.price_version_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      requestId: r.id,
      priceVersionId: r.price_version_id,
      variantId: r.variant_id,
      costLak: Number(r.cost_lak),
      sellingPriceLak: Number(r.selling_price_lak),
      marginLak: Number(r.margin_lak),
      belowCost: r.below_cost,
      versionStatus: r.version_status,
      status: r.request_status,
      makerIdentityId: r.maker_identity_id,
      approverIdentityId: r.approver_identity_id,
      requiresOwner: r.requires_owner,
      requires2fa: r.requires_2fa,
      reason: r.reason,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
  }
}
