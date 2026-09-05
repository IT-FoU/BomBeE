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
    const existing = await this.db.query<{
      identity_id: string;
      staff_profile_id: string;
    }>(
      `SELECT i.id AS identity_id, sp.id AS staff_profile_id
       FROM security.auth_identities i
       JOIN app.staff_profiles sp ON sp.auth_identity_id = i.id
       WHERE i.subject = $1
       LIMIT 1`,
      [subject],
    );
    if (existing.rows[0]) {
      return {
        identityId: existing.rows[0].identity_id,
        staffProfileId: existing.rows[0].staff_profile_id,
      };
    }

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

  async ensureStaffRole(staffProfileId: string, roleCode: string, assignedBy?: string) {
    await this.db.query(
      `INSERT INTO security.staff_role_assignments (staff_profile_id, role_code, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (staff_profile_id, role_code) DO NOTHING`,
      [staffProfileId, roleCode, assignedBy ?? null],
    );
  }

  async listStaffDirectory(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      staff_profile_id: string;
      identity_id: string;
      subject: string;
      display_name: string;
      phone_e164: string | null;
      status: string;
      roles: string | null;
    }>(
      `SELECT sp.id AS staff_profile_id,
              i.id AS identity_id,
              i.subject,
              sp.display_name,
              i.phone_e164,
              i.status,
              string_agg(sra.role_code, ',' ORDER BY sra.role_code)
                FILTER (WHERE sra.revoked_at IS NULL) AS roles
       FROM app.staff_profiles sp
       JOIN security.auth_identities i ON i.id = sp.auth_identity_id
       LEFT JOIN security.staff_role_assignments sra ON sra.staff_profile_id = sp.id
       GROUP BY sp.id, i.id, i.subject, sp.display_name, i.phone_e164, i.status
       ORDER BY sp.display_name ASC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      staffProfileId: r.staff_profile_id,
      identityId: r.identity_id,
      subject: r.subject,
      displayName: r.display_name,
      phoneE164: r.phone_e164,
      status: r.status,
      roles: r.roles ? r.roles.split(',') : [],
    }));
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

  async listDevices(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      auth_identity_id: string;
      subject: string | null;
      display_name: string | null;
      device_fingerprint: string;
      user_agent: string | null;
      ip: string | null;
      trusted: boolean;
      first_seen_at: string;
      last_seen_at: string;
    }>(
      `SELECT d.id, d.auth_identity_id, i.subject, sp.display_name,
              d.device_fingerprint, d.user_agent, d.ip::text,
              d.trusted, d.first_seen_at::text, d.last_seen_at::text
       FROM security.devices d
       JOIN security.auth_identities i ON i.id = d.auth_identity_id
       LEFT JOIN app.staff_profiles sp ON sp.auth_identity_id = d.auth_identity_id
       ORDER BY d.last_seen_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      deviceId: r.id,
      authIdentityId: r.auth_identity_id,
      subject: r.subject,
      displayName: r.display_name,
      fingerprint: r.device_fingerprint,
      userAgent: r.user_agent,
      ip: r.ip,
      trusted: r.trusted,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }));
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

  async listOwnerRecoveryRequests(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      owner_identity_id: string;
      owner_subject: string | null;
      owner_display_name: string | null;
      status: string;
      evidence_ref: string;
      reason: string;
      created_at: string;
      resolved_at: string | null;
      resolved_by: string | null;
    }>(
      `SELECT r.id, r.owner_identity_id, i.subject AS owner_subject,
              sp.display_name AS owner_display_name,
              r.status, r.evidence_ref, r.reason,
              r.created_at::text, r.resolved_at::text, r.resolved_by
       FROM security.owner_recovery_requests r
       JOIN security.auth_identities i ON i.id = r.owner_identity_id
       LEFT JOIN app.staff_profiles sp ON sp.auth_identity_id = r.owner_identity_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      requestId: r.id,
      ownerIdentityId: r.owner_identity_id,
      ownerSubject: r.owner_subject,
      ownerDisplayName: r.owner_display_name,
      status: r.status,
      evidenceRef: r.evidence_ref,
      reason: r.reason,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    }));
  }

  get maxFailedLogins() {
    return MAX_FAILED_LOGINS;
  }
}
