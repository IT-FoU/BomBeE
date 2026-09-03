-- Migration: payment_ledger
-- Apply: payment requests/attempts/receipts/allocations/refunds/adjustments + COD controls
-- Rollback/recovery: restore finance payment tables from backup; never rewrite ledger rows

CREATE TABLE finance.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL REFERENCES app.parent_orders(id),
  reference_code text NOT NULL UNIQUE,
  method text NOT NULL CHECK (method IN ('qr', 'cod')),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partially_paid', 'paid', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE finance.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES finance.payment_requests(id),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  UNIQUE (payment_request_id, child_order_id)
);

CREATE TABLE finance.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES finance.payment_requests(id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  channel text NOT NULL CHECK (channel IN ('manual', 'bank_api', 'cod_courier')),
  amount_reported_lak bigint NOT NULL CHECK (amount_reported_lak >= 0),
  evidence_storage_key text,
  evidence_status text NOT NULL DEFAULT 'pending'
    CHECK (evidence_status IN ('pending', 'verified', 'rejected', 'not_required')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  idempotency_key text NOT NULL UNIQUE,
  bank_or_courier_ref text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  confirmed_at timestamptz,
  UNIQUE (payment_request_id, attempt_no)
);

CREATE UNIQUE INDEX payment_attempts_bank_ref_uniq
  ON finance.payment_attempts (bank_or_courier_ref)
  WHERE bank_or_courier_ref IS NOT NULL;

CREATE TABLE finance.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL UNIQUE REFERENCES finance.payment_attempts(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  received_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  source text NOT NULL CHECK (source IN ('manual', 'bank_api', 'courier_remittance'))
);

CREATE OR REPLACE FUNCTION finance.deny_payment_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment ledger rows are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION finance.deny_payment_amount_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.amount_lak IS DISTINCT FROM NEW.amount_lak
     OR OLD.reference_code IS DISTINCT FROM NEW.reference_code
     OR OLD.parent_order_id IS DISTINCT FROM NEW.parent_order_id THEN
    RAISE EXCEPTION 'payment_request identity/amount fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_requests_no_update_amounts
BEFORE UPDATE ON finance.payment_requests
FOR EACH ROW EXECUTE FUNCTION finance.deny_payment_amount_change();

CREATE TRIGGER trg_payment_allocations_immutable
BEFORE UPDATE OR DELETE ON finance.payment_allocations
FOR EACH ROW EXECUTE FUNCTION finance.deny_payment_ledger_mutation();

CREATE TRIGGER trg_payment_receipts_immutable
BEFORE UPDATE OR DELETE ON finance.payment_receipts
FOR EACH ROW EXECUTE FUNCTION finance.deny_payment_ledger_mutation();

CREATE TABLE finance.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES finance.payment_requests(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  reason text NOT NULL CHECK (reason IN ('excess', 'cancellation', 'adjustment', 'other')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  linked_attempt_id uuid REFERENCES finance.payment_attempts(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE finance.payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES finance.payment_requests(id),
  child_order_id uuid REFERENCES app.child_orders(id),
  amount_lak bigint NOT NULL CHECK (amount_lak <> 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT payment_adjust_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE finance.cod_profiles (
  customer_identity_id uuid PRIMARY KEY REFERENCES security.auth_identities(id),
  is_new_customer boolean NOT NULL DEFAULT true,
  failed_cod_count integer NOT NULL DEFAULT 0 CHECK (failed_cod_count >= 0),
  qr_forced boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE finance.cod_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  shipment_id uuid REFERENCES app.shipments(id),
  amount_lak bigint NOT NULL CHECK (amount_lak >= 0),
  deposit_lak bigint NOT NULL DEFAULT 0 CHECK (deposit_lak >= 0),
  balance_due_lak bigint NOT NULL CHECK (balance_due_lak >= 0),
  phone_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'collected', 'failed', 'remitted')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (balance_due_lak = amount_lak - deposit_lak)
);

CREATE TABLE finance.courier_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_ref text NOT NULL UNIQUE,
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  received_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  notes text
);

CREATE TABLE finance.cod_remittance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cod_shipment_id uuid NOT NULL REFERENCES finance.cod_shipments(id),
  remittance_id uuid NOT NULL REFERENCES finance.courier_remittances(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  UNIQUE (cod_shipment_id, remittance_id)
);

CREATE TABLE finance.recon_mismatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mismatch_type text NOT NULL CHECK (mismatch_type IN ('bank', 'cod', 'allocation')),
  reference_id text NOT NULL,
  expected_lak bigint NOT NULL,
  actual_lak bigint NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'written_off')),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz
);

CREATE TABLE finance.redelivery_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  reason text NOT NULL DEFAULT 'customer_unreachable',
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE VIEW finance.daily_payment_totals AS
SELECT
  (timezone('utc', r.received_at))::date AS day_utc,
  sum(r.amount_lak) AS receipt_total_lak,
  count(*) AS receipt_count
FROM finance.payment_receipts r
GROUP BY 1;

GRANT ALL ON ALL TABLES IN SCHEMA finance TO bombee_service;
GRANT SELECT ON finance.daily_payment_totals TO bombee_service;
