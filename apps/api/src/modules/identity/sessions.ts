export const BACKOFFICE_IDLE_MS = 60 * 60_000;
export const MAX_FAILED_LOGINS = 5;

export type SessionAudience = 'customer' | 'backoffice';

export type SessionRecord = {
  id: string;
  authIdentityId: string;
  deviceId?: string;
  audience: SessionAudience;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  revokedAt?: number;
  revokeReason?: string;
};

export function isSessionActive(session: SessionRecord, now: number): boolean {
  if (session.revokedAt) return false;
  if (now > session.expiresAt) return false;
  if (session.audience === 'backoffice' && now - session.lastActivityAt > BACKOFFICE_IDLE_MS) {
    return false;
  }
  return true;
}

export function touchSession(session: SessionRecord, now: number): SessionRecord {
  if (!isSessionActive(session, now)) {
    return {
      ...session,
      revokedAt: session.revokedAt ?? now,
      revokeReason: session.revokeReason ?? 'idle_or_expired',
    };
  }
  return { ...session, lastActivityAt: now };
}

export function shouldLockAccount(failedLoginCount: number): boolean {
  return failedLoginCount >= MAX_FAILED_LOGINS;
}

export type UnlockDecision =
  | { ok: true }
  | { ok: false; reason: 'self_unlock_forbidden' | 'insufficient_role' | 'owner_required_for_admin' };

export function canUnlockStaff(input: {
  actorRoles: string[];
  targetRoles: string[];
  actorIdentityId: string;
  targetIdentityId: string;
}): UnlockDecision {
  if (input.actorIdentityId === input.targetIdentityId) {
    return { ok: false, reason: 'self_unlock_forbidden' };
  }
  if (input.targetRoles.includes('owner')) {
    return { ok: false, reason: 'insufficient_role' };
  }
  if (input.targetRoles.includes('admin')) {
    return input.actorRoles.includes('owner')
      ? { ok: true }
      : { ok: false, reason: 'owner_required_for_admin' };
  }
  if (input.actorRoles.includes('owner') || input.actorRoles.includes('admin')) {
    return { ok: true };
  }
  return { ok: false, reason: 'insufficient_role' };
}
