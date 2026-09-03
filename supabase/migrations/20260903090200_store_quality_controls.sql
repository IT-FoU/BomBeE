-- Migration: store_quality_controls
-- Apply: rolling 30-day counters, suspension/reactivation with evidence and audit hooks
-- Rollback/recovery: restore private quality tables; preserve suspension audit via security.audit_events

CREATE TABLE private.store_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  event_type text NOT NULL CHECK (event_type IN (
    'slow_response_or_pack',
    'stock_mismatch',
    'wrong_damaged_mismatch',
    'fraud_or_security'
  )),
  occurred_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX store_quality_events_store_time_idx
  ON private.store_quality_events (store_id, event_type, occurred_at DESC);

CREATE TABLE private.store_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  reason_code text NOT NULL CHECK (reason_code IN (
    'slow_response_or_pack',
    'stock_mismatch',
    'wrong_damaged_mismatch',
    'fraud_or_security',
    'document_expired',
    'manual'
  )),
  reason_detail text NOT NULL,
  suspended_by uuid REFERENCES security.auth_identities(id),
  suspended_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  reactivated_at timestamptz,
  reactivated_by uuid REFERENCES security.auth_identities(id),
  corrective_action_evidence text,
  active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX store_one_active_suspension
  ON private.store_suspensions (store_id)
  WHERE active = true;

CREATE TABLE private.document_expiry_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES private.store_documents(id),
  alert_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
