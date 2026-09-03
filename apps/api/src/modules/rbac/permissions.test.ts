import { describe, expect, it } from 'vitest';

import { evaluatePermissions, hasPermission, buildTrustedClaims } from './permissions.js';
import {
  buildDelegationDailySummary,
  decideApproval,
  revokeDelegation,
} from './makerChecker.js';

describe('permission evaluator', () => {
  it('applies role defaults and deny overrides', () => {
    const granted = evaluatePermissions({
      roles: ['support'],
      overrides: [{ permission: 'customers.read_pii', effect: 'deny' }],
    });
    expect(hasPermission(granted, 'backoffice.access')).toBe(true);
    expect(hasPermission(granted, 'customers.read_pii')).toBe(false);
  });

  it('builds server-trusted claims only', () => {
    const claims = buildTrustedClaims({
      identityId: 'id-1',
      roles: ['finance'],
      permissions: ['exports.request', 'backoffice.access'],
    });
    expect(claims.iss).toBe('bombee-api');
    expect(claims.permissions).not.toContain('roles.admin_change');
  });
});

describe('maker-checker', () => {
  it('rejects self-approval', () => {
    const result = decideApproval({
      request: {
        id: 'r1',
        approvalType: 'exports.approve',
        makerIdentityId: 'maker',
        status: 'pending',
        requiresOwner: false,
        requires2fa: false,
      },
      actorIdentityId: 'maker',
      actorRoles: ['owner'],
      delegations: [],
      stepUpVerified: true,
      now: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: 'self_approval' });
  });

  it('requires Owner + 2FA for finance/admin permission changes', () => {
    const adminAttempt = decideApproval({
      request: {
        id: 'r2',
        approvalType: 'roles.finance_change',
        makerIdentityId: 'maker',
        status: 'pending',
        requiresOwner: true,
        requires2fa: true,
      },
      actorIdentityId: 'admin',
      actorRoles: ['admin'],
      delegations: [],
      stepUpVerified: true,
      now: Date.now(),
    });
    expect(adminAttempt).toEqual({ ok: false, reason: 'owner_required' });

    const ownerNo2fa = decideApproval({
      request: {
        id: 'r2',
        approvalType: 'roles.finance_change',
        makerIdentityId: 'maker',
        status: 'pending',
        requiresOwner: true,
        requires2fa: true,
      },
      actorIdentityId: 'owner',
      actorRoles: ['owner'],
      delegations: [],
      stepUpVerified: false,
      now: Date.now(),
    });
    expect(ownerNo2fa).toEqual({ ok: false, reason: '2fa_required' });
  });

  it('allows delegated admin with 2FA and supports revoke + daily summary', () => {
    const delegated = decideApproval({
      request: {
        id: 'r3',
        approvalType: 'price.below_cost',
        makerIdentityId: 'maker',
        status: 'pending',
        requiresOwner: true,
        requires2fa: true,
      },
      actorIdentityId: 'admin-id',
      actorRoles: ['admin'],
      actorStaffProfileId: 'staff-admin',
      delegations: [
        {
          adminStaffProfileId: 'staff-admin',
          adminIdentityId: 'admin-id',
          approvalType: 'price.below_cost',
          active: true,
        },
      ],
      stepUpVerified: true,
      now: Date.now(),
    });
    expect(delegated).toEqual({ ok: true, requiresBanner: true });

    expect(
      revokeDelegation(
        {
          adminStaffProfileId: 'staff-admin',
          adminIdentityId: 'admin-id',
          approvalType: 'price.below_cost',
          active: true,
        },
        ['admin'],
      ),
    ).toEqual({ ok: false, reason: 'owner_only' });

    const summary = buildDelegationDailySummary({
      ownerIdentityId: 'owner',
      summaryDate: '2026-09-03',
      activeDelegations: [
        {
          adminStaffProfileId: 'staff-admin',
          adminIdentityId: 'admin-id',
          approvalType: 'price.below_cost',
          active: true,
        },
      ],
    });
    expect(summary.count).toBe(1);
  });
});
