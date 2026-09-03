-- Migration: catalog_media_pricing
-- Apply: media assets, price versions, price/discount approvals
-- Rollback/recovery: restore media/price tables; never rewrite approved price history

CREATE TABLE private.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES app.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES app.product_variants(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  duration_seconds integer,
  width_px integer,
  height_px integer,
  thumbnail_key text,
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'passed', 'rejected')),
  validation_notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL),
  CHECK (
    (media_type = 'image' AND duration_seconds IS NULL)
    OR (media_type = 'video' AND duration_seconds IS NOT NULL)
  )
);

CREATE TABLE finance.price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  cost_lak bigint NOT NULL CHECK (cost_lak >= 0),
  selling_price_lak bigint NOT NULL CHECK (selling_price_lak >= 0),
  compare_at_price_lak bigint CHECK (compare_at_price_lak IS NULL OR compare_at_price_lak >= 0),
  margin_lak bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  below_cost boolean NOT NULL DEFAULT false,
  reason text,
  created_by uuid REFERENCES security.auth_identities(id),
  approved_by uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  approved_at timestamptz,
  UNIQUE (variant_id, version_no),
  CHECK (margin_lak = selling_price_lak - cost_lak),
  CHECK (below_cost = (selling_price_lak < cost_lak))
);

CREATE UNIQUE INDEX price_one_approved_active
  ON finance.price_versions (variant_id)
  WHERE status = 'approved';

CREATE OR REPLACE FUNCTION finance.deny_price_overwrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'price_versions cannot be deleted';
  END IF;
  IF OLD.cost_lak IS DISTINCT FROM NEW.cost_lak
     OR OLD.selling_price_lak IS DISTINCT FROM NEW.selling_price_lak
     OR OLD.compare_at_price_lak IS DISTINCT FROM NEW.compare_at_price_lak THEN
    RAISE EXCEPTION 'price amounts are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_versions_no_overwrite
BEFORE UPDATE ON finance.price_versions
FOR EACH ROW EXECUTE FUNCTION finance.deny_price_overwrite();

CREATE TABLE finance.price_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_version_id uuid NOT NULL REFERENCES finance.price_versions(id),
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
  CONSTRAINT price_change_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE finance.near_expiry_discount_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  proposed_selling_price_lak bigint NOT NULL CHECK (proposed_selling_price_lak >= 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT near_expiry_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

GRANT ALL ON ALL TABLES IN SCHEMA finance TO bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
