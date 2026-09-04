import type { PGlite } from '@electric-sql/pglite';

export type InviteRole = 'customer' | 'store_owner' | 'ops' | 'admin';

export type BetaInvite = {
  id: string;
  inviteCode: string;
  phoneE164: string | null;
  email: string | null;
  intendedRole: InviteRole;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type InviteAccessDecision =
  | { allowed: true; reason: 'invite_not_required' | 'invite_valid' }
  | { allowed: false; reason: 'invite_required' | 'invite_invalid' | 'invite_exhausted' | 'invite_expired' | 'invite_revoked' };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function evaluateInviteAccess(input: {
  inviteOnlyEnabled: boolean;
  invite: BetaInvite | null;
  now?: Date;
}): InviteAccessDecision {
  if (!input.inviteOnlyEnabled) {
    return { allowed: true, reason: 'invite_not_required' };
  }
  if (!input.invite) {
    return { allowed: false, reason: 'invite_required' };
  }
  if (input.invite.revokedAt) {
    return { allowed: false, reason: 'invite_revoked' };
  }
  const now = input.now ?? new Date();
  if (input.invite.expiresAt && new Date(input.invite.expiresAt).getTime() < now.getTime()) {
    return { allowed: false, reason: 'invite_expired' };
  }
  if (input.invite.useCount >= input.invite.maxUses) {
    return { allowed: false, reason: 'invite_exhausted' };
  }
  return { allowed: true, reason: 'invite_valid' };
}

export class InviteService {
  constructor(private readonly db: PGlite) {}

  async createInvite(input: {
    inviteCode: string;
    phoneE164?: string | null;
    email?: string | null;
    intendedRole?: InviteRole;
    maxUses?: number;
    expiresAt?: string | null;
    note?: string | null;
    createdByIdentityId?: string | null;
  }): Promise<BetaInvite> {
    const code = normalizeCode(input.inviteCode);
    const row = await this.db.query<{
      id: string;
      invite_code: string;
      phone_e164: string | null;
      email: string | null;
      intended_role: InviteRole;
      max_uses: number;
      use_count: number;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `INSERT INTO app.beta_invites (
         invite_code, phone_e164, email, intended_role, max_uses, expires_at, note, created_by_identity_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, invite_code, phone_e164, email, intended_role, max_uses, use_count, expires_at, revoked_at`,
      [
        code,
        input.phoneE164 ?? null,
        input.email ?? null,
        input.intendedRole ?? 'customer',
        input.maxUses ?? 1,
        input.expiresAt ?? null,
        input.note ?? null,
        input.createdByIdentityId ?? null,
      ],
    );
    return mapInvite(row.rows[0]!);
  }

  async findByCode(inviteCode: string): Promise<BetaInvite | null> {
    const row = await this.db.query<{
      id: string;
      invite_code: string;
      phone_e164: string | null;
      email: string | null;
      intended_role: InviteRole;
      max_uses: number;
      use_count: number;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT id, invite_code, phone_e164, email, intended_role, max_uses, use_count, expires_at, revoked_at
       FROM app.beta_invites WHERE invite_code = $1`,
      [normalizeCode(inviteCode)],
    );
    const found = row.rows[0];
    return found ? mapInvite(found) : null;
  }

  async listInvites(limit = 50): Promise<BetaInvite[]> {
    const row = await this.db.query<{
      id: string;
      invite_code: string;
      phone_e164: string | null;
      email: string | null;
      intended_role: InviteRole;
      max_uses: number;
      use_count: number;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT id, invite_code, phone_e164, email, intended_role, max_uses, use_count, expires_at, revoked_at
       FROM app.beta_invites
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return row.rows.map(mapInvite);
  }

  async redeem(input: {
    inviteCode: string;
    inviteOnlyEnabled: boolean;
    identityId?: string | null;
    phoneE164?: string | null;
    now?: Date;
  }): Promise<InviteAccessDecision & { inviteId?: string }> {
    const invite = await this.findByCode(input.inviteCode);
    const decision = evaluateInviteAccess({
      inviteOnlyEnabled: input.inviteOnlyEnabled,
      invite,
      now: input.now,
    });
    if (!decision.allowed || !invite) {
      return decision;
    }
    if (decision.reason === 'invite_not_required') {
      return decision;
    }

    await this.db.query(
      `UPDATE app.beta_invites SET use_count = use_count + 1 WHERE id = $1`,
      [invite.id],
    );
    await this.db.query(
      `INSERT INTO app.beta_invite_redemptions (invite_id, identity_id, phone_e164)
       VALUES ($1,$2,$3)`,
      [invite.id, input.identityId ?? null, input.phoneE164 ?? null],
    );
    return { ...decision, inviteId: invite.id };
  }
}

function mapInvite(row: {
  id: string;
  invite_code: string;
  phone_e164: string | null;
  email: string | null;
  intended_role: InviteRole;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
}): BetaInvite {
  return {
    id: row.id,
    inviteCode: row.invite_code,
    phoneE164: row.phone_e164,
    email: row.email,
    intendedRole: row.intended_role,
    maxUses: row.max_uses,
    useCount: row.use_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
