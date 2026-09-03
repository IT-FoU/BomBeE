export const PERMISSIONS = [
  'staff.read',
  'staff.unlock',
  'roles.assign',
  'roles.finance_change',
  'roles.admin_change',
  'approvals.decide',
  'delegations.manage',
  'customers.read_pii',
  'exports.request',
  'exports.approve',
  'exports.download',
  'audit.read',
  'backoffice.access',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const HIGH_RISK_APPROVAL_TYPES = [
  'roles.finance_change',
  'roles.admin_change',
  'payout.account_change',
  'price.below_cost',
  'export.approve',
] as const;

export type HighRiskApprovalType = (typeof HIGH_RISK_APPROVAL_TYPES)[number];
