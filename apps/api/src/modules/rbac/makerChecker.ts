import type { AppRole, HighRiskApprovalType } from '@bombee/shared';
import { HIGH_RISK_APPROVAL_TYPES } from '@bombee/shared';

export type ApprovalRequest = {
  id: string;
  approvalType: string;
  makerIdentityId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requiresOwner: boolean;
  requires2fa: boolean;
  stepUpVerifiedAt?: number;
  approverIdentityId?: string;
};

export type Delegation = {
  adminStaffProfileId: string;
  adminIdentityId: string;
  approvalType: string;
  active: boolean;
};

export type DecideApprovalInput = {
  request: ApprovalRequest;
  actorIdentityId: string;
  actorRoles: AppRole[];
  actorStaffProfileId?: string;
  delegations: Delegation[];
  stepUpVerified: boolean;
  now: number;
};

export type DecideApprovalResult =
  | { ok: true; requiresBanner: boolean }
  | {
      ok: false;
      reason:
        | 'self_approval'
        | 'not_pending'
        | 'owner_required'
        | '2fa_required'
        | 'not_authorized';
    };

export function isHighRiskApproval(type: string): type is HighRiskApprovalType {
  return (HIGH_RISK_APPROVAL_TYPES as readonly string[]).includes(type);
}

export function requiresOwnerForPermissionChange(approvalType: string): boolean {
  return approvalType === 'roles.finance_change' || approvalType === 'roles.admin_change';
}

export function decideApproval(input: DecideApprovalInput): DecideApprovalResult {
  const { request, actorIdentityId, actorRoles, delegations, stepUpVerified } = input;

  if (request.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (request.makerIdentityId === actorIdentityId) return { ok: false, reason: 'self_approval' };

  const isOwner = actorRoles.includes('owner');
  const activeDelegation = delegations.find(
    (d) =>
      d.active &&
      d.adminIdentityId === actorIdentityId &&
      d.approvalType === request.approvalType,
  );

  if (request.requiresOwner || requiresOwnerForPermissionChange(request.approvalType)) {
    if (!isOwner && !activeDelegation) return { ok: false, reason: 'owner_required' };
  } else if (!isOwner && !actorRoles.includes('admin') && !activeDelegation) {
    return { ok: false, reason: 'not_authorized' };
  }

  const needs2fa =
    request.requires2fa ||
    isHighRiskApproval(request.approvalType) ||
    Boolean(activeDelegation && !isOwner);

  if (needs2fa && !stepUpVerified) return { ok: false, reason: '2fa_required' };

  return { ok: true, requiresBanner: Boolean(activeDelegation && !isOwner) };
}

export function revokeDelegation(
  delegation: Delegation,
  actorRoles: AppRole[],
): { ok: true } | { ok: false; reason: 'owner_only' } {
  if (!actorRoles.includes('owner')) return { ok: false, reason: 'owner_only' };
  return { ok: true };
}

export function buildDelegationDailySummary(input: {
  ownerIdentityId: string;
  summaryDate: string;
  activeDelegations: Delegation[];
}) {
  return {
    ownerIdentityId: input.ownerIdentityId,
    summaryDate: input.summaryDate,
    count: input.activeDelegations.length,
    items: input.activeDelegations.map((d) => ({
      adminIdentityId: d.adminIdentityId,
      approvalType: d.approvalType,
    })),
  };
}
