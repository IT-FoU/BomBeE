import type { AppRole, PermissionCode } from '@bombee/shared';
import { PERMISSIONS } from '@bombee/shared';

export type PermissionEffect = 'allow' | 'deny';

export type PermissionOverride = {
  permission: PermissionCode;
  effect: PermissionEffect;
};

const ROLE_DEFAULTS: Record<AppRole, PermissionCode[]> = {
  owner: [...PERMISSIONS],
  admin: [
    'staff.read',
    'staff.unlock',
    'approvals.decide',
    'customers.read_pii',
    'exports.request',
    'exports.download',
    'audit.read',
    'backoffice.access',
  ],
  finance: ['exports.request', 'audit.read', 'backoffice.access'],
  operations: ['staff.read', 'backoffice.access'],
  catalog: ['backoffice.access'],
  support: ['customers.read_pii', 'backoffice.access'],
  auditor: ['audit.read', 'backoffice.access'],
};

export function defaultPermissionsForRoles(roles: AppRole[]): Set<PermissionCode> {
  const set = new Set<PermissionCode>();
  for (const role of roles) {
    for (const permission of ROLE_DEFAULTS[role]) set.add(permission);
  }
  return set;
}

export function evaluatePermissions(input: {
  roles: AppRole[];
  overrides?: PermissionOverride[];
}): Set<PermissionCode> {
  const granted = defaultPermissionsForRoles(input.roles);
  for (const override of input.overrides ?? []) {
    if (override.effect === 'allow') granted.add(override.permission);
    if (override.effect === 'deny') granted.delete(override.permission);
  }
  return granted;
}

export function hasPermission(
  granted: Set<PermissionCode>,
  permission: PermissionCode,
): boolean {
  return granted.has(permission);
}

/** Authorization claims must only be derived server-side. */
export function buildTrustedClaims(input: {
  identityId: string;
  roles: AppRole[];
  permissions: PermissionCode[];
}) {
  return {
    sub: input.identityId,
    roles: input.roles,
    permissions: input.permissions,
    iss: 'bombee-api',
  };
}
