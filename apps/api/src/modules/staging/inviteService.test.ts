import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { evaluateInviteAccess, InviteService } from './inviteService.js';

describe('evaluateInviteAccess', () => {
  it('allows when invite-only is disabled', () => {
    expect(
      evaluateInviteAccess({ inviteOnlyEnabled: false, invite: null }),
    ).toEqual({ allowed: true, reason: 'invite_not_required' });
  });

  it('requires an invite when enabled', () => {
    expect(
      evaluateInviteAccess({ inviteOnlyEnabled: true, invite: null }),
    ).toEqual({ allowed: false, reason: 'invite_required' });
  });

  it('rejects exhausted and expired invites', () => {
    const base = {
      id: '1',
      inviteCode: 'BETA-1',
      phoneE164: null,
      email: null,
      intendedRole: 'customer' as const,
      maxUses: 1,
      useCount: 1,
      expiresAt: null,
      revokedAt: null,
    };
    expect(evaluateInviteAccess({ inviteOnlyEnabled: true, invite: base })).toEqual({
      allowed: false,
      reason: 'invite_exhausted',
    });
    expect(
      evaluateInviteAccess({
        inviteOnlyEnabled: true,
        invite: { ...base, useCount: 0, expiresAt: '2020-01-01T00:00:00.000Z' },
        now: new Date('2026-09-03T00:00:00.000Z'),
      }),
    ).toEqual({ allowed: false, reason: 'invite_expired' });
  });
});

describe('InviteService', () => {
  let db: PGlite;
  let service: InviteService;

  beforeAll(async () => {
    db = await createTestDatabase();
    service = new InviteService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates and redeems a synthetic invite once', async () => {
    const invite = await service.createInvite({
      inviteCode: 'qa-beta-001',
      maxUses: 1,
      note: 'synthetic staging invite',
    });
    expect(invite.inviteCode).toBe('QA-BETA-001');

    const first = await service.redeem({
      inviteCode: 'qa-beta-001',
      inviteOnlyEnabled: true,
      phoneE164: '+8562099990001',
    });
    expect(first.allowed).toBe(true);
    expect(first.reason).toBe('invite_valid');

    const second = await service.redeem({
      inviteCode: 'QA-BETA-001',
      inviteOnlyEnabled: true,
    });
    expect(second).toEqual({ allowed: false, reason: 'invite_exhausted' });
  });
});
