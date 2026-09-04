import type { PGlite } from '@electric-sql/pglite';

export const QUALITY_WINDOW_MS = 30 * 24 * 60 * 60_000;

export const QUALITY_THRESHOLDS = {
  slow_response_or_pack: 5,
  stock_mismatch: 3,
  wrong_damaged_mismatch: 3,
} as const;

export type QualityEventType = keyof typeof QUALITY_THRESHOLDS | 'fraud_or_security';

export function shouldSuspendForCounts(
  counts: Partial<Record<keyof typeof QUALITY_THRESHOLDS, number>>,
): keyof typeof QUALITY_THRESHOLDS | null {
  for (const [type, threshold] of Object.entries(QUALITY_THRESHOLDS) as Array<
    [keyof typeof QUALITY_THRESHOLDS, number]
  >) {
    if ((counts[type] ?? 0) >= threshold) return type;
  }
  return null;
}

export class QualityService {
  constructor(private readonly db: PGlite) {}

  async recordEvent(input: {
    storeId: string;
    eventType: QualityEventType;
    occurredAt?: number;
    meta?: Record<string, unknown>;
  }) {
    const occurredAt = new Date(input.occurredAt ?? Date.now()).toISOString();
    await this.db.query(
      `INSERT INTO private.store_quality_events (store_id, event_type, occurred_at, meta)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [input.storeId, input.eventType, occurredAt, JSON.stringify(input.meta ?? {})],
    );

    if (input.eventType === 'fraud_or_security') {
      await this.suspend({
        storeId: input.storeId,
        reasonCode: 'fraud_or_security',
        reasonDetail: 'immediate fraud/security suspension',
      });
      return { suspended: true as const, reason: 'fraud_or_security' };
    }

    const counts = await this.rollingCounts(input.storeId, input.occurredAt ?? Date.now());
    const hit = shouldSuspendForCounts(counts);
    if (hit) {
      await this.suspend({
        storeId: input.storeId,
        reasonCode: hit,
        reasonDetail: `threshold reached in 30-day window`,
      });
      return { suspended: true as const, reason: hit, counts };
    }
    return { suspended: false as const, counts };
  }

  async rollingCounts(storeId: string, now: number) {
    const since = new Date(now - QUALITY_WINDOW_MS).toISOString();
    const rows = await this.db.query<{ event_type: string; n: number }>(
      `SELECT event_type, count(*)::int AS n
       FROM private.store_quality_events
       WHERE store_id = $1 AND occurred_at >= $2::timestamptz
         AND event_type <> 'fraud_or_security'
       GROUP BY event_type`,
      [storeId, since],
    );
    const counts: Partial<Record<keyof typeof QUALITY_THRESHOLDS, number>> = {};
    for (const row of rows.rows) {
      counts[row.event_type as keyof typeof QUALITY_THRESHOLDS] = row.n;
    }
    return counts;
  }

  async suspend(input: {
    storeId: string;
    reasonCode: string;
    reasonDetail: string;
    suspendedBy?: string;
  }) {
    await this.db.query(
      `UPDATE app.stores
       SET status = 'suspended',
           can_accept_orders = false,
           products_visible = true,
           existing_orders_under_review = true
       WHERE id = $1`,
      [input.storeId],
    );
    await this.db.query(
      `UPDATE private.store_suspensions SET active = false
       WHERE store_id = $1 AND active = true`,
      [input.storeId],
    );
    await this.db.query(
      `INSERT INTO private.store_suspensions
        (store_id, reason_code, reason_detail, suspended_by, active)
       VALUES ($1,$2,$3,$4,true)`,
      [input.storeId, input.reasonCode, input.reasonDetail, input.suspendedBy ?? null],
    );
  }

  async reactivate(input: {
    storeId: string;
    actorIdentityId: string;
    actorRoles: string[];
    correctiveActionEvidence: string;
  }) {
    if (!input.actorRoles.includes('owner') && !input.actorRoles.includes('admin')) {
      return { ok: false as const, reason: 'not_authorized' };
    }
    if (input.correctiveActionEvidence.trim().length < 8) {
      return { ok: false as const, reason: 'evidence_required' };
    }

    await this.db.query(
      `UPDATE private.store_suspensions
       SET active = false, reactivated_at = timezone('utc', now()),
           reactivated_by = $2, corrective_action_evidence = $3
       WHERE store_id = $1 AND active = true`,
      [input.storeId, input.actorIdentityId, input.correctiveActionEvidence],
    );
    await this.db.query(
      `UPDATE app.stores
       SET status = 'active', can_accept_orders = true,
           existing_orders_under_review = false
       WHERE id = $1`,
      [input.storeId],
    );
    return { ok: true as const };
  }

  async listEvents(limit = 50, storeId?: string) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      store_id: string;
      event_type: string;
      occurred_at: string;
      meta: unknown;
    }>(
      storeId
        ? `SELECT id, store_id, event_type, occurred_at::text, meta
           FROM private.store_quality_events
           WHERE store_id = $1
           ORDER BY occurred_at DESC
           LIMIT $2`
        : `SELECT id, store_id, event_type, occurred_at::text, meta
           FROM private.store_quality_events
           ORDER BY occurred_at DESC
           LIMIT $1`,
      storeId ? [storeId, capped] : [capped],
    );
    return rows.rows.map((r) => ({
      eventId: r.id,
      storeId: r.store_id,
      eventType: r.event_type,
      occurredAt: r.occurred_at,
      meta: r.meta,
    }));
  }

  async listSuspensions(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      store_id: string;
      reason_code: string;
      reason_detail: string | null;
      active: boolean;
      suspended_at: string;
      reactivated_at: string | null;
    }>(
      `SELECT id, store_id, reason_code, reason_detail, active,
              suspended_at::text, reactivated_at::text
       FROM private.store_suspensions
       ORDER BY suspended_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      suspensionId: r.id,
      storeId: r.store_id,
      reasonCode: r.reason_code,
      reasonDetail: r.reason_detail,
      active: r.active,
      suspendedAt: r.suspended_at,
      reactivatedAt: r.reactivated_at,
    }));
  }
}
