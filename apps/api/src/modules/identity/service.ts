import type { PGlite } from '@electric-sql/pglite';

import {
  generateOtpCode,
  hashOtp,
  otpAcceptedResponse,
  evaluateOtpRateLimit,
  type OtpPurpose,
  type SmsProvider,
  type RateLimitState,
  DEFAULT_OTP_RATE_LIMIT,
} from './otp.js';
import { canUnlockStaff, MAX_FAILED_LOGINS, shouldLockAccount } from './sessions.js';
import type { NotificationBus } from '../notifications/bus.js';

export class IdentityService {
  private readonly rateLimits = new Map<string, RateLimitState>();

  constructor(
    private readonly db: PGlite,
    private readonly sms: SmsProvider,
    private readonly notifications?: NotificationBus,
  ) {}

  async ensureCustomer(phoneE164: string, displayName: string) {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM security.auth_identities WHERE phone_e164 = $1`,
      [phoneE164],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const identity = await this.db.query<{ id: string }>(
      `INSERT INTO security.auth_identities (subject, identity_type, phone_e164)
       VALUES ($1, 'customer', $2) RETURNING id`,
      [`customer:${phoneE164}`, phoneE164],
    );
    const identityId = identity.rows[0]!.id;
    await this.db.query(
      `INSERT INTO app.customer_profiles (auth_identity_id, display_name)
       VALUES ($1, $2)`,
      [identityId, displayName],
    );
    return identityId;
  }

  async ensureStaff(subject: string, displayName: string, phoneE164?: string) {
    const identity = await this.db.query<{ id: string }>(
      `INSERT INTO security.auth_identities (subject, identity_type, phone_e164)
       VALUES ($1, 'staff', $2) RETURNING id`,
      [subject, phoneE164 ?? null],
    );
    const identityId = identity.rows[0]!.id;
    const staff = await this.db.query<{ id: string }>(
      `INSERT INTO app.staff_profiles (auth_identity_id, display_name)
       VALUES ($1, $2) RETURNING id`,
      [identityId, displayName],
    );
    return { identityId, staffProfileId: staff.rows[0]!.id };
  }

  async requestOtp(input: {
    phoneE164: string;
    purpose: OtpPurpose;
    correlationId: string;
    captchaToken?: string;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const bucketKey = `${input.purpose}:${input.phoneE164}`;
    const current = this.rateLimits.get(bucketKey) ?? {
      bucketKey,
      windowStartedAt: now,
      requestCount: 0,
      captchaRequired: false,
    };
    const decision = evaluateOtpRateLimit(current, now, DEFAULT_OTP_RATE_LIMIT);
    this.rateLimits.set(bucketKey, { ...decision.next, bucketKey });

    if (!decision.allow) {
      return { ...otpAcceptedResponse(input.correlationId), limited: true as const };
    }

    if (decision.next.captchaRequired && !input.captchaToken) {
      return {
        ...otpAcceptedResponse(input.correlationId),
        captchaRequired: true as const,
      };
    }

    const code = generateOtpCode();
    const expiresAt = new Date(now + 5 * 60_000).toISOString();
    await this.db.query(
      `INSERT INTO security.otp_challenges
        (purpose, destination_phone_e164, code_hash, correlation_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.purpose, input.phoneE164, hashOtp(code), input.correlationId, expiresAt],
    );
    await this.sms.sendOtp({ phoneE164: input.phoneE164, code, purpose: input.purpose });
    return otpAcceptedResponse(input.correlationId);
  }

  async verifyOtp(input: {
    phoneE164: string;
    purpose: OtpPurpose;
    code: string;
    now?: number;
  }): Promise<{ ok: true; challengeId: string } | { ok: false; reason: string }> {
    const now = input.now ?? Date.now();
    const rows = await this.db.query<{
      id: string;
      code_hash: string;
      expires_at: string;
      consumed_at: string | null;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, code_hash, expires_at::text, consumed_at::text, attempts, max_attempts
       FROM security.otp_challenges
       WHERE destination_phone_e164 = $1 AND purpose = $2
       ORDER BY created_at DESC LIMIT 1`,
      [input.phoneE164, input.purpose],
    );
    const challenge = rows.rows[0];
    if (!challenge) return { ok: false, reason: 'not_found' };
    if (challenge.consumed_at) return { ok: false, reason: 'replayed' };
    if (Date.parse(challenge.expires_at) < now) return { ok: false, reason: 'expired' };
    if (challenge.attempts >= challenge.max_attempts) return { ok: false, reason: 'locked' };

    const valid = hashOtp(input.code) === challenge.code_hash;
    await this.db.query(`UPDATE security.otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [
      challenge.id,
    ]);
    if (!valid) return { ok: false, reason: 'invalid' };

    await this.db.query(
      `UPDATE security.otp_challenges SET consumed_at = timezone('utc', now()) WHERE id = $1`,
      [challenge.id],
    );
    return { ok: true, challengeId: challenge.id };
  }

  async registerDevice(input: {
    authIdentityId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }) {
    const existing = await this.db.query<{ id: string; trusted: boolean }>(
      `SELECT id, trusted FROM security.devices
       WHERE auth_identity_id = $1 AND device_fingerprint = $2`,
      [input.authIdentityId, input.fingerprint],
    );
    if (existing.rows[0]) {
      await this.db.query(
        `UPDATE security.devices SET last_seen_at = timezone('utc', now()) WHERE id = $1`,
        [existing.rows[0].id],
      );
      return { deviceId: existing.rows[0].id, isNew: false as const };
    }

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO security.devices (auth_identity_id, device_fingerprint, user_agent, ip)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.authIdentityId, input.fingerprint, input.userAgent ?? null, input.ip ?? null],
    );
    const deviceId = inserted.rows[0]!.id;
    await this.notifications?.notifyOwnerNewDevice({
      staffIdentityId: input.authIdentityId,
      deviceId,
      fingerprint: input.fingerprint,
    });
    return { deviceId, isNew: true as const };
  }

  async createSession(input: {
    authIdentityId: string;
    deviceId?: string;
    audience: 'customer' | 'backoffice';
    ttlMs: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const expiresAt = new Date(now + input.ttlMs).toISOString();
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO security.sessions
        (auth_identity_id, device_id, audience, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.authIdentityId, input.deviceId ?? null, input.audience, expiresAt],
    );
    const sessionId = row.rows[0]!.id;
    await this.notifications?.notifyAllSessions({
      authIdentityId: input.authIdentityId,
      sessionId,
      deviceId: input.deviceId,
    });
    return sessionId;
  }

  async getSession(sessionId: string, now = Date.now()) {
    const row = await this.db.query<{
      id: string;
      auth_identity_id: string;
      audience: string;
      expires_at: string;
      revoked_at: string | null;
      phone_e164: string | null;
      display_name: string | null;
    }>(
      `SELECT s.id, s.auth_identity_id, s.audience, s.expires_at::text, s.revoked_at::text,
              i.phone_e164, coalesce(c.display_name, st.display_name) AS display_name
       FROM security.sessions s
       JOIN security.auth_identities i ON i.id = s.auth_identity_id
       LEFT JOIN app.customer_profiles c ON c.auth_identity_id = i.id
       LEFT JOIN app.staff_profiles st ON st.auth_identity_id = i.id
       WHERE s.id = $1`,
      [sessionId],
    );
    const session = row.rows[0];
    if (!session) return null;
    if (session.revoked_at) return null;
    if (Date.parse(session.expires_at) < now) return null;
    return {
      sessionId: session.id,
      identityId: session.auth_identity_id,
      audience: session.audience,
      expiresAt: session.expires_at,
      phoneE164: session.phone_e164,
      displayName: session.display_name,
    };
  }

  async revokeSession(sessionId: string, reason: string) {
    await this.db.query(
      `UPDATE security.sessions
       SET revoked_at = timezone('utc', now()), revoke_reason = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }

  async revokeAllSessions(authIdentityId: string, reason: string) {
    await this.db.query(
      `UPDATE security.sessions
       SET revoked_at = timezone('utc', now()), revoke_reason = $2
       WHERE auth_identity_id = $1 AND revoked_at IS NULL`,
      [authIdentityId, reason],
    );
  }

  async recordFailedLogin(authIdentityId: string) {
    const row = await this.db.query<{ failed_login_count: number }>(
      `UPDATE security.auth_identities
       SET failed_login_count = failed_login_count + 1
       WHERE id = $1
       RETURNING failed_login_count`,
      [authIdentityId],
    );
    const count = row.rows[0]!.failed_login_count;
    if (shouldLockAccount(count)) {
      await this.db.query(
        `UPDATE security.auth_identities
         SET status = 'locked', locked_at = timezone('utc', now()), locked_reason = 'max_failures'
         WHERE id = $1`,
        [authIdentityId],
      );
    }
    return count;
  }

  async unlockIdentity(input: {
    targetIdentityId: string;
    actorIdentityId: string;
    actorRoles: string[];
    targetRoles: string[];
    reason: string;
  }) {
    const decision = canUnlockStaff({
      actorRoles: input.actorRoles,
      targetRoles: input.targetRoles,
      actorIdentityId: input.actorIdentityId,
      targetIdentityId: input.targetIdentityId,
    });
    if (!decision.ok) return decision;

    await this.db.query(
      `UPDATE security.auth_identities
       SET status = 'active', failed_login_count = 0, locked_at = NULL, locked_reason = NULL
       WHERE id = $1`,
      [input.targetIdentityId],
    );
    await this.db.query(
      `INSERT INTO security.unlock_events (target_identity_id, actor_identity_id, reason)
       VALUES ($1, $2, $3)`,
      [input.targetIdentityId, input.actorIdentityId, input.reason],
    );
    return decision;
  }

  async createOwnerRecoveryRequest(input: {
    ownerIdentityId: string;
    evidenceRef: string;
    reason: string;
  }) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO security.owner_recovery_requests
        (owner_identity_id, evidence_ref, reason)
       VALUES ($1, $2, $3) RETURNING id`,
      [input.ownerIdentityId, input.evidenceRef, input.reason],
    );
    return row.rows[0]!.id;
  }

  get maxFailedLogins() {
    return MAX_FAILED_LOGINS;
  }
}
