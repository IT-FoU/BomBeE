-- Migration: identity_and_sessions
-- Apply: customer/staff profiles, OTP, devices, sessions, lockouts
-- Rollback/recovery: restore security/app identity tables from backup; do not DELETE audit trails

CREATE TABLE security.auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL UNIQUE,
  identity_type text NOT NULL CHECK (identity_type IN ('customer', 'staff')),
  phone_e164 text,
  email text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'disabled', 'pending_recovery')),
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_at timestamptz,
  locked_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT auth_identities_phone_unique UNIQUE (phone_e164),
  CONSTRAINT auth_identities_customer_phone_required
    CHECK (identity_type <> 'customer' OR phone_e164 IS NOT NULL)
);

CREATE TRIGGER trg_auth_identities_updated
BEFORE UPDATE ON security.auth_identities
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_identity_id uuid NOT NULL UNIQUE REFERENCES security.auth_identities(id),
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'lo' CHECK (locale IN ('lo', 'en')),
  marketing_opt_in boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz
);

CREATE TRIGGER trg_customer_profiles_updated
BEFORE UPDATE ON app.customer_profiles
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_identity_id uuid NOT NULL UNIQUE REFERENCES security.auth_identities(id),
  display_name text NOT NULL,
  staff_status text NOT NULL DEFAULT 'active'
    CHECK (staff_status IN ('active', 'suspended', 'offboarded')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz
);

CREATE TRIGGER trg_staff_profiles_updated
BEFORE UPDATE ON app.staff_profiles
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE security.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN (
    'customer_login', 'staff_login', 'staff_new_device', 'phone_change_old',
    'phone_change_new', 'step_up_2fa', 'account_recovery'
  )),
  destination_phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX otp_challenges_dest_created_idx
  ON security.otp_challenges (destination_phone_e164, created_at DESC);
CREATE INDEX otp_challenges_correlation_idx
  ON security.otp_challenges (correlation_id);

CREATE TABLE security.otp_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  cooldown_until timestamptz,
  captcha_required boolean NOT NULL DEFAULT false,
  UNIQUE (bucket_key, window_started_at)
);

CREATE TABLE security.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  device_fingerprint text NOT NULL,
  label text,
  user_agent text,
  ip inet,
  trusted boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (auth_identity_id, device_fingerprint)
);

CREATE INDEX devices_identity_idx ON security.devices (auth_identity_id);

CREATE TABLE security.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  device_id uuid REFERENCES security.devices(id),
  audience text NOT NULL CHECK (audience IN ('customer', 'backoffice')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_activity_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);

CREATE INDEX sessions_identity_active_idx
  ON security.sessions (auth_identity_id)
  WHERE revoked_at IS NULL;

CREATE TABLE security.unlock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  actor_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT unlock_not_self CHECK (target_identity_id <> actor_identity_id)
);

CREATE TABLE security.owner_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  evidence_ref text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES security.auth_identities(id)
);

-- Money example column convention (integer LAK) for future financial FKs
CREATE TABLE private.money_unit_example (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_lak bigint NOT NULL CHECK (amount_lak >= 0),
  note text NOT NULL DEFAULT 'LAK amounts are integer kip only'
);

GRANT SELECT, INSERT, UPDATE ON app.customer_profiles TO bombee_authenticated, bombee_service;
GRANT SELECT ON app.customer_profiles TO bombee_anon;
GRANT SELECT, INSERT, UPDATE ON app.staff_profiles TO bombee_authenticated, bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA security TO bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
