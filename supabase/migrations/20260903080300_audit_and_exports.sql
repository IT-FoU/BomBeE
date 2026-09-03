-- Migration: audit_and_exports
-- Apply: append-only audit events, export workflow, encrypted artifact metadata
-- Rollback/recovery: NEVER delete audit rows; restore from append-only backup if corrupted

CREATE TABLE security.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identity_id uuid REFERENCES security.auth_identities(id),
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  ip inet,
  device_id uuid REFERENCES security.devices(id),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  retain_until date NOT NULL DEFAULT ((timezone('utc', now())::date + INTERVAL '5 years')::date)
);

CREATE INDEX audit_events_actor_idx ON security.audit_events (actor_identity_id, created_at DESC);
CREATE INDEX audit_events_target_idx ON security.audit_events (target_type, target_id);
CREATE INDEX audit_events_correlation_idx ON security.audit_events (correlation_id);

-- Prevent UPDATE/DELETE from application roles via revoke + trigger guard
CREATE OR REPLACE FUNCTION security.deny_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON security.audit_events
FOR EACH ROW EXECUTE FUNCTION security.deny_audit_mutation();

CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON security.audit_events
FOR EACH ROW EXECUTE FUNCTION security.deny_audit_mutation();

CREATE TABLE security.customer_pii_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  customer_profile_id uuid NOT NULL REFERENCES app.customer_profiles(id),
  fields text[] NOT NULL,
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE security.export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  export_type text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) >= 8),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'ready', 'expired', 'deleted')),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  approved_at timestamptz,
  artifact_ciphertext bytea,
  artifact_nonce bytea,
  download_limit integer NOT NULL DEFAULT 3 CHECK (download_limit > 0),
  download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  deleted_at timestamptz,
  CONSTRAINT export_no_self_approve CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> requester_identity_id
  )
);

CREATE TABLE security.export_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_request_id uuid NOT NULL REFERENCES security.export_requests(id),
  actor_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'approved', 'rejected', 'downloaded', 'expired', 'deleted'
  )),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT ON security.audit_events TO bombee_service;
-- Explicitly no UPDATE/DELETE grants for audit_events
GRANT ALL ON security.customer_pii_access_logs TO bombee_service;
GRANT ALL ON security.export_requests TO bombee_service;
GRANT ALL ON security.export_access_events TO bombee_service;
