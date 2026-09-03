import type { PGlite } from '@electric-sql/pglite';

import type { NotificationBus } from '../notifications/bus.js';

export const PAYOUT_HOLD_MS = 48 * 60 * 60_000;

export class PayoutService {
  constructor(
    private readonly db: PGlite,
    private readonly notifications?: NotificationBus,
  ) {}

  async createPendingVersion(input: {
    storeId: string;
    bankName: string;
    accountNumberLast4: string;
    accountHolder: string;
  }) {
    const latest = await this.db.query<{ version_no: number }>(
      `SELECT version_no FROM finance.payout_account_versions
       WHERE store_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [input.storeId],
    );
    const versionNo = (latest.rows[0]?.version_no ?? 0) + 1;
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.payout_account_versions
        (store_id, version_no, bank_name, account_number_last4, account_holder, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
      [
        input.storeId,
        versionNo,
        input.bankName,
        input.accountNumberLast4,
        input.accountHolder,
      ],
    );
    return row.rows[0]!.id;
  }

  async requestChange(input: {
    storeId: string;
    requestedVersionId: string;
    makerIdentityId: string;
  }) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.payout_change_requests
        (store_id, requested_version_id, maker_identity_id, requires_2fa)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [input.storeId, input.requestedVersionId, input.makerIdentityId],
    );
    return row.rows[0]!.id;
  }

  async approveChange(input: {
    requestId: string;
    approverIdentityId: string;
    actorRoles: string[];
    stepUpVerified: boolean;
    now?: number;
  }) {
    if (!input.actorRoles.includes('owner')) {
      return { ok: false as const, reason: 'owner_required' };
    }
    if (!input.stepUpVerified) {
      return { ok: false as const, reason: '2fa_required' };
    }

    const req = await this.db.query<{
      id: string;
      store_id: string;
      requested_version_id: string;
      maker_identity_id: string;
      status: string;
    }>(
      `SELECT id, store_id, requested_version_id, maker_identity_id, status
       FROM finance.payout_change_requests WHERE id = $1`,
      [input.requestId],
    );
    const current = req.rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' };
    if (current.status !== 'pending') return { ok: false as const, reason: 'not_pending' };
    if (current.maker_identity_id === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }

    const now = input.now ?? Date.now();
    const holdUntil = new Date(now + PAYOUT_HOLD_MS).toISOString();

    await this.db.query(
      `UPDATE finance.payout_account_versions
       SET status = 'superseded'
       WHERE store_id = $1 AND status = 'active'`,
      [current.store_id],
    );
    await this.db.query(
      `UPDATE finance.payout_account_versions
       SET status = 'active', activated_at = to_timestamp($2 / 1000.0),
           payout_hold_until = $3::timestamptz
       WHERE id = $1`,
      [current.requested_version_id, now, holdUntil],
    );
    await this.db.query(
      `UPDATE finance.payout_change_requests
       SET status = 'approved', approver_identity_id = $2,
           step_up_verified_at = to_timestamp($3 / 1000.0),
           decided_at = to_timestamp($3 / 1000.0)
       WHERE id = $1`,
      [current.id, input.approverIdentityId, now],
    );

    await this.notifications?.publish({
      channel: 'in_app',
      toRole: 'owner',
      template: 'payout.account_changed',
      payload: {
        storeId: current.store_id,
        versionId: current.requested_version_id,
        holdUntil,
      },
    });

    return { ok: true as const, holdUntil };
  }

  async settlementPayoutVersion(storeId: string, settlementAt: number) {
    const row = await this.db.query<{
      id: string;
      payout_hold_until: string | null;
      status: string;
    }>(
      `SELECT id, payout_hold_until::text, status
       FROM finance.payout_account_versions
       WHERE store_id = $1 AND status = 'active'
       LIMIT 1`,
      [storeId],
    );
    const active = row.rows[0];
    if (!active) return { ok: false as const, reason: 'no_active_account' };
    if (active.payout_hold_until && Date.parse(active.payout_hold_until) > settlementAt) {
      return { ok: false as const, reason: 'payout_hold_active', versionId: active.id };
    }
    return { ok: true as const, versionId: active.id };
  }
}
