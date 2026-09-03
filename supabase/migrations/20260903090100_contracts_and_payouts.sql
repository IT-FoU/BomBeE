-- Migration: contracts_and_payouts
-- Apply: immutable contract versions, payout account versions, change requests
-- Rollback/recovery: restore finance contract/payout tables; never rewrite historical versions

CREATE TABLE finance.store_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  revenue_model text NOT NULL CHECK (revenue_model IN (
    'markup', 'commission', 'per_order_fee', 'mixed'
  )),
  markup_bps integer CHECK (markup_bps IS NULL OR markup_bps >= 0),
  commission_bps integer CHECK (commission_bps IS NULL OR commission_bps >= 0),
  per_order_fee_lak bigint CHECK (per_order_fee_lak IS NULL OR per_order_fee_lak >= 0),
  settlement_cadence text NOT NULL CHECK (settlement_cadence IN (
    'daily', 'weekly', 'monthly', 'custom'
  )),
  custom_cadence_days integer CHECK (
    (settlement_cadence = 'custom' AND custom_cadence_days IS NOT NULL AND custom_cadence_days > 0)
    OR (settlement_cadence <> 'custom' AND custom_cadence_days IS NULL)
  ),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES security.auth_identities(id),
  UNIQUE (store_id, version_no),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Immutability guard
CREATE OR REPLACE FUNCTION finance.deny_contract_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'store_contract_versions are immutable';
END;
$$;

CREATE TRIGGER trg_contract_versions_no_update
BEFORE UPDATE ON finance.store_contract_versions
FOR EACH ROW EXECUTE FUNCTION finance.deny_contract_mutation();

CREATE TRIGGER trg_contract_versions_no_delete
BEFORE DELETE ON finance.store_contract_versions
FOR EACH ROW EXECUTE FUNCTION finance.deny_contract_mutation();

-- Snapshot target used by Child Orders (Milestone 5 will FK here)
CREATE TABLE finance.order_contract_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL UNIQUE,
  store_id uuid NOT NULL REFERENCES app.stores(id),
  contract_version_id uuid NOT NULL REFERENCES finance.store_contract_versions(id),
  revenue_model text NOT NULL,
  markup_bps integer,
  commission_bps integer,
  per_order_fee_lak bigint,
  settlement_cadence text NOT NULL,
  custom_cadence_days integer,
  snapped_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION finance.deny_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_contract_snapshots are immutable';
END;
$$;

CREATE TRIGGER trg_order_contract_snapshots_no_update
BEFORE UPDATE ON finance.order_contract_snapshots
FOR EACH ROW EXECUTE FUNCTION finance.deny_snapshot_mutation();

CREATE TRIGGER trg_order_contract_snapshots_no_delete
BEFORE DELETE ON finance.order_contract_snapshots
FOR EACH ROW EXECUTE FUNCTION finance.deny_snapshot_mutation();

CREATE TABLE finance.payout_account_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  bank_name text NOT NULL,
  account_number_last4 text NOT NULL CHECK (char_length(account_number_last4) = 4),
  account_holder text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'superseded', 'rejected')),
  activated_at timestamptz,
  payout_hold_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, version_no)
);

CREATE UNIQUE INDEX payout_one_active_per_store
  ON finance.payout_account_versions (store_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION finance.deny_payout_version_overwrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_account_versions cannot be deleted';
  END IF;
  IF OLD.bank_name IS DISTINCT FROM NEW.bank_name
     OR OLD.account_number_last4 IS DISTINCT FROM NEW.account_number_last4
     OR OLD.account_holder IS DISTINCT FROM NEW.account_holder THEN
    RAISE EXCEPTION 'payout account fields are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payout_versions_no_overwrite
BEFORE UPDATE ON finance.payout_account_versions
FOR EACH ROW EXECUTE FUNCTION finance.deny_payout_version_overwrite();

CREATE TABLE finance.payout_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  requested_version_id uuid NOT NULL REFERENCES finance.payout_account_versions(id),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requires_2fa boolean NOT NULL DEFAULT true,
  step_up_verified_at timestamptz,
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT payout_change_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

GRANT ALL ON ALL TABLES IN SCHEMA finance TO bombee_service;
