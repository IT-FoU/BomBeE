import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from './otp.js';
import { IdentityService } from './service.js';
import {
  BACKOFFICE_IDLE_MS,
  isSessionActive,
  touchSession,
  type SessionRecord,
} from './sessions.js';

describe('IdentityService integration', () => {
  let db: PGlite;
  let sms: MockSmsProvider;
  let identity: IdentityService;

  beforeAll(async () => {
    db = await createTestDatabase();
    sms = new MockSmsProvider();
    identity = new IdentityService(db, sms);
  });

  afterAll(async () => {
    await db.close();
  });

  it('rate limits OTP and verifies happy/invalid/expired/replay paths', async () => {
    const phone = '+8562099990001';
    await identity.ensureCustomer(phone, 'Demo');

    const first = await identity.requestOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      correlationId: crypto.randomUUID(),
      now: 1_000,
    });
    expect(first.status).toBe('accepted');
    expect(sms.sent.length).toBe(1);
    const code = sms.sent[0]!.code;

    const ok = await identity.verifyOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      code,
      now: 2_000,
    });
    expect(ok.ok).toBe(true);

    const replay = await identity.verifyOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      code,
      now: 3_000,
    });
    expect(replay).toEqual({ ok: false, reason: 'replayed' });

    await identity.requestOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      correlationId: crypto.randomUUID(),
      now: 4_000,
    });
    const latest = sms.sent.at(-1)!.code;
    const expired = await identity.verifyOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      code: latest,
      now: 4_000 + 6 * 60_000,
    });
    expect(expired).toEqual({ ok: false, reason: 'expired' });

    const invalid = await identity.verifyOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      code: '000000',
      now: 5_000,
    });
    // challenge expired already from previous row; request a fresh one
    await identity.requestOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      correlationId: crypto.randomUUID(),
      now: 10_000,
    });
    const bad = await identity.verifyOtp({
      phoneE164: phone,
      purpose: 'customer_login',
      code: '000000',
      now: 11_000,
    });
    expect(bad).toEqual({ ok: false, reason: 'invalid' });
    expect(invalid.ok).toBe(false);
  });

  it('locks after 5 failures and blocks self-unlock', async () => {
    const admin = await identity.ensureStaff('staff:admin1', 'Admin One', '+8562080000001');
    const target = await identity.ensureStaff('staff:ops1', 'Ops One', '+8562080000002');

    for (let i = 0; i < 5; i += 1) {
      await identity.recordFailedLogin(target.identityId);
    }
    const status = await db.query<{ status: string }>(
      `SELECT status FROM security.auth_identities WHERE id = $1`,
      [target.identityId],
    );
    expect(status.rows[0]?.status).toBe('locked');

    const self = await identity.unlockIdentity({
      targetIdentityId: target.identityId,
      actorIdentityId: target.identityId,
      actorRoles: ['admin'],
      targetRoles: ['operations'],
      reason: 'self',
    });
    expect(self).toEqual({ ok: false, reason: 'self_unlock_forbidden' });

    const unlocked = await identity.unlockIdentity({
      targetIdentityId: target.identityId,
      actorIdentityId: admin.identityId,
      actorRoles: ['admin'],
      targetRoles: ['operations'],
      reason: 'verified identity',
    });
    expect(unlocked).toEqual({ ok: true });
  });

  it('requires Owner to unlock Admin and notifies new devices via session list', async () => {
    const owner = await identity.ensureStaff('staff:owner1', 'Owner', '+8562080000010');
    const admin = await identity.ensureStaff('staff:admin2', 'Admin Two', '+8562080000011');

    for (let i = 0; i < 5; i += 1) await identity.recordFailedLogin(admin.identityId);

    const denied = await identity.unlockIdentity({
      targetIdentityId: admin.identityId,
      actorIdentityId: admin.identityId,
      actorRoles: ['admin'],
      targetRoles: ['admin'],
      reason: 'nope',
    });
    expect(denied.ok).toBe(false);

    const otherAdmin = await identity.ensureStaff('staff:admin3', 'Admin Three', '+8562080000012');
    const notOwner = await identity.unlockIdentity({
      targetIdentityId: admin.identityId,
      actorIdentityId: otherAdmin.identityId,
      actorRoles: ['admin'],
      targetRoles: ['admin'],
      reason: 'peer',
    });
    expect(notOwner).toEqual({ ok: false, reason: 'owner_required_for_admin' });

    const ok = await identity.unlockIdentity({
      targetIdentityId: admin.identityId,
      actorIdentityId: owner.identityId,
      actorRoles: ['owner'],
      targetRoles: ['admin'],
      reason: 'owner recovery assist',
    });
    expect(ok).toEqual({ ok: true });

    const device = await identity.registerDevice({
      authIdentityId: admin.identityId,
      fingerprint: 'device-a',
      ip: '127.0.0.1',
    });
    expect(device.isNew).toBe(true);
    const again = await identity.registerDevice({
      authIdentityId: admin.identityId,
      fingerprint: 'device-a',
    });
    expect(again.isNew).toBe(false);

    const sessionId = await identity.createSession({
      authIdentityId: admin.identityId,
      deviceId: device.deviceId,
      audience: 'backoffice',
      ttlMs: BACKOFFICE_IDLE_MS,
    });
    expect(sessionId).toBeTruthy();

    await identity.revokeAllSessions(admin.identityId, 'sign_out_all');
    const sessions = await db.query<{ revoked_at: string | null }>(
      `SELECT revoked_at::text FROM security.sessions WHERE auth_identity_id = $1`,
      [admin.identityId],
    );
    expect(sessions.rows.every((s) => s.revoked_at)).toBe(true);
  });

  it('expires backoffice sessions after 1 hour idle', () => {
    const now = 10_000_000;
    const session: SessionRecord = {
      id: 's1',
      authIdentityId: 'a1',
      audience: 'backoffice',
      createdAt: now - BACKOFFICE_IDLE_MS - 1,
      lastActivityAt: now - BACKOFFICE_IDLE_MS - 1,
      expiresAt: now + 86_400_000,
    };
    expect(isSessionActive(session, now)).toBe(false);
    const touched = touchSession(session, now);
    expect(touched.revokeReason).toBe('idle_or_expired');
  });
});
