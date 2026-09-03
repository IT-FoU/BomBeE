-- Migration: reports_notifications_search_ego_backup
-- Apply: report scopes, notification inbox/retry, search images, EGO placeholder, backups
-- Rollback/recovery: restore supporting tables; EGO remains disabled (no credentials)

CREATE SCHEMA IF NOT EXISTS integrations;

CREATE TABLE app.notification_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  channel text NOT NULL CHECK (channel IN ('in_app', 'sms', 'push', 'email')),
  template text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  action_link text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('in_app', 'sms', 'push', 'email')),
  provider text NOT NULL,
  destination text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  sent_at timestamptz
);

CREATE TABLE app.search_image_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_id uuid REFERENCES security.auth_identities(id),
  storage_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  consent_search_only boolean NOT NULL DEFAULT true,
  consent_train_analytics boolean NOT NULL DEFAULT false,
  ocr_text text,
  barcode_value text,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  delete_failed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (consent_search_only = true),
  CHECK (consent_train_analytics = false)
);

CREATE TABLE integrations.ego_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES app.stores(id),
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'not_configured', 'enabled')),
  source_of_truth text NOT NULL DEFAULT 'marketplace'
    CHECK (source_of_truth IN ('marketplace', 'ego')),
  feature_flag_on boolean NOT NULL DEFAULT false,
  credentials_configured boolean NOT NULL DEFAULT false,
  last_health_at timestamptz,
  last_full_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (credentials_configured = false),
  CHECK (feature_flag_on = false),
  CHECK (status IN ('disabled', 'not_configured'))
);

CREATE TABLE integrations.ego_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  marketplace_variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  suggested_external_id text NOT NULL,
  approved_external_id text,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'approved', 'rejected')),
  approved_by uuid REFERENCES security.auth_identities(id),
  approved_at timestamptz,
  UNIQUE (store_id, marketplace_variant_id)
);

CREATE TABLE integrations.ego_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  stream text NOT NULL CHECK (stream IN ('product', 'stock', 'order')),
  cursor_value text NOT NULL DEFAULT '0',
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, stream)
);

CREATE TABLE integrations.ego_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  external_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ego_to_market')),
  event_type text NOT NULL CHECK (event_type IN ('product', 'stock')),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE integrations.ego_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  external_id text,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('market_to_ego')),
  event_type text NOT NULL CHECK (event_type IN ('order')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'blocked_flag_off')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE integrations.ego_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES integrations.ego_outbox(id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  ok boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (outbox_id, attempt_no)
);

CREATE TABLE integrations.ego_error_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL UNIQUE REFERENCES integrations.ego_outbox(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE private.backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('daily_critical', 'weekly_full', 'pre_migration')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  storage_uri text,
  encrypted boolean NOT NULL DEFAULT true,
  offline_copy_uri text,
  checksum_sha256 text,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  rpo_seconds integer,
  rto_seconds integer,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE private.backup_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_job_id uuid NOT NULL REFERENCES private.backup_jobs(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

GRANT USAGE ON SCHEMA integrations TO bombee_service;
GRANT ALL ON app.notification_inbox, app.notification_outbox, app.search_image_uploads
  TO bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA integrations TO bombee_service;
GRANT ALL ON private.backup_jobs, private.backup_alerts TO bombee_service;
