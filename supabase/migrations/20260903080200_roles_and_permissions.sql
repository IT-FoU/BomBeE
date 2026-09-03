-- Migration: roles_and_permissions
-- Apply: role catalog, permissions, overrides, maker-checker, delegations
-- Rollback/recovery: restore security.rbac* from backup; never silently drop active delegations

CREATE TABLE security.permission_catalog (
  code text PRIMARY KEY,
  description text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE security.role_defaults (
  role_code text NOT NULL CHECK (role_code IN (
    'owner', 'admin', 'finance', 'operations', 'catalog', 'support', 'auditor'
  )),
  permission_code text NOT NULL REFERENCES security.permission_catalog(code),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE security.staff_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id uuid NOT NULL REFERENCES app.staff_profiles(id),
  role_code text NOT NULL CHECK (role_code IN (
    'owner', 'admin', 'finance', 'operations', 'catalog', 'support', 'auditor'
  )),
  assigned_by uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  revoked_at timestamptz,
  UNIQUE (staff_profile_id, role_code)
);

CREATE TABLE security.staff_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id uuid NOT NULL REFERENCES app.staff_profiles(id),
  permission_code text NOT NULL REFERENCES security.permission_catalog(code),
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  revoked_at timestamptz,
  UNIQUE (staff_profile_id, permission_code)
);

CREATE TABLE security.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requires_owner boolean NOT NULL DEFAULT false,
  requires_2fa boolean NOT NULL DEFAULT false,
  step_up_verified_at timestamptz,
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT approval_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE INDEX approval_requests_status_idx ON security.approval_requests (status, created_at DESC);

CREATE TABLE security.owner_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_staff_profile_id uuid NOT NULL REFERENCES app.staff_profiles(id),
  approval_type text NOT NULL,
  granted_by_owner_id uuid NOT NULL REFERENCES security.auth_identities(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  revoked_at timestamptz,
  revoke_reason text
);

CREATE UNIQUE INDEX owner_delegations_active_uniq
  ON security.owner_delegations (admin_staff_profile_id, approval_type)
  WHERE active = true;

CREATE TABLE security.delegation_daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  summary_date date NOT NULL,
  body jsonb NOT NULL,
  sent_at timestamptz,
  UNIQUE (owner_identity_id, summary_date)
);

INSERT INTO security.permission_catalog (code, description, risk_level) VALUES
  ('staff.read', 'View staff profiles', 'low'),
  ('staff.unlock', 'Unlock locked staff accounts', 'high'),
  ('roles.assign', 'Assign staff roles', 'critical'),
  ('roles.finance_change', 'Change finance role or permissions', 'critical'),
  ('roles.admin_change', 'Change admin role or permissions', 'critical'),
  ('approvals.decide', 'Approve or reject maker-checker requests', 'high'),
  ('delegations.manage', 'Grant or revoke Owner delegations', 'critical'),
  ('customers.read_pii', 'View full customer PII', 'high'),
  ('exports.request', 'Request data exports', 'medium'),
  ('exports.approve', 'Approve data exports', 'high'),
  ('exports.download', 'Download approved exports', 'high'),
  ('audit.read', 'Read audit events', 'medium'),
  ('backoffice.access', 'Access backoffice shell', 'low');

INSERT INTO security.role_defaults (role_code, permission_code) VALUES
  ('owner', 'staff.read'),
  ('owner', 'staff.unlock'),
  ('owner', 'roles.assign'),
  ('owner', 'roles.finance_change'),
  ('owner', 'roles.admin_change'),
  ('owner', 'approvals.decide'),
  ('owner', 'delegations.manage'),
  ('owner', 'customers.read_pii'),
  ('owner', 'exports.request'),
  ('owner', 'exports.approve'),
  ('owner', 'exports.download'),
  ('owner', 'audit.read'),
  ('owner', 'backoffice.access'),
  ('admin', 'staff.read'),
  ('admin', 'staff.unlock'),
  ('admin', 'approvals.decide'),
  ('admin', 'customers.read_pii'),
  ('admin', 'exports.request'),
  ('admin', 'exports.download'),
  ('admin', 'audit.read'),
  ('admin', 'backoffice.access'),
  ('finance', 'exports.request'),
  ('finance', 'audit.read'),
  ('finance', 'backoffice.access'),
  ('operations', 'staff.read'),
  ('operations', 'backoffice.access'),
  ('catalog', 'backoffice.access'),
  ('support', 'customers.read_pii'),
  ('support', 'backoffice.access'),
  ('auditor', 'audit.read'),
  ('auditor', 'backoffice.access');

GRANT ALL ON ALL TABLES IN SCHEMA security TO bombee_service;
