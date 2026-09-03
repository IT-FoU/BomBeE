-- Migration: store_domain
-- Apply: stores, contacts, risk, fulfillment locations, onboarding docs
-- Rollback/recovery: restore app/private store tables from backup; keep audit of doc access

CREATE TABLE app.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'onboarding', 'active', 'suspended', 'offboarded')),
  can_accept_orders boolean NOT NULL DEFAULT false,
  products_visible boolean NOT NULL DEFAULT true,
  existing_orders_under_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz
);

CREATE TRIGGER trg_stores_updated
BEFORE UPDATE ON app.stores
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.store_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  contact_type text NOT NULL CHECK (contact_type IN ('owner', 'ops', 'finance', 'support')),
  full_name text NOT NULL,
  phone_e164 text NOT NULL,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX store_contacts_one_primary_owner
  ON app.store_contacts (store_id)
  WHERE contact_type = 'owner' AND is_primary = true;

CREATE TABLE app.store_risk_profiles (
  store_id uuid PRIMARY KEY REFERENCES app.stores(id),
  risk_tier text NOT NULL DEFAULT 'standard'
    CHECK (risk_tier IN ('low', 'standard', 'elevated', 'critical')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.fulfillment_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  name text NOT NULL,
  address_line text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz
);

-- Phase 1 business rule: at most one active fulfillment location per store
CREATE UNIQUE INDEX fulfillment_one_active_per_store
  ON app.fulfillment_locations (store_id)
  WHERE active = true AND archived_at IS NULL;

CREATE TABLE private.store_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  doc_type text NOT NULL CHECK (doc_type IN (
    'owner_id', 'store_info', 'bank_account', 'contract'
  )),
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'verified', 'rejected', 'expired')),
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  verified_at timestamptz
);

CREATE UNIQUE INDEX store_documents_latest_type
  ON private.store_documents (store_id, doc_type, created_at DESC);

CREATE TABLE private.store_document_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES private.store_documents(id),
  actor_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  access_mode text NOT NULL CHECK (access_mode IN ('signed_url', 'metadata')),
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE private.store_onboarding_checklists (
  store_id uuid PRIMARY KEY REFERENCES app.stores(id),
  owner_id_ok boolean NOT NULL DEFAULT false,
  store_info_ok boolean NOT NULL DEFAULT false,
  bank_account_ok boolean NOT NULL DEFAULT false,
  contract_ok boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE private.signed_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE app.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stores FORCE ROW LEVEL SECURITY;
ALTER TABLE app.store_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.store_risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store_risk_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.fulfillment_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fulfillment_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY stores_service_all ON app.stores
  FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY stores_auth_read_active ON app.stores
  FOR SELECT TO bombee_authenticated
  USING (status IN ('active', 'suspended') AND products_visible = true);

CREATE POLICY store_contacts_service_all ON app.store_contacts
  FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY store_risk_service_all ON app.store_risk_profiles
  FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY fulfillment_service_all ON app.fulfillment_locations
  FOR ALL TO bombee_service USING (true) WITH CHECK (true);

GRANT SELECT ON app.stores TO bombee_authenticated, bombee_anon, bombee_service;
GRANT SELECT, INSERT, UPDATE ON app.stores TO bombee_service;
GRANT ALL ON app.store_contacts TO bombee_service;
GRANT ALL ON app.store_risk_profiles TO bombee_service;
GRANT ALL ON app.fulfillment_locations TO bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
