-- Migration: inventory_ledger
-- Apply: balances, append-only transactions, safety buffers, verification due, import batches
-- Rollback/recovery: restore inventory tables from backup; never rewrite transaction history

CREATE TABLE private.inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  location_id uuid NOT NULL REFERENCES app.fulfillment_locations(id),
  lot_code text NOT NULL,
  production_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'blocked', 'recall', 'expired', 'exhausted')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, variant_id, location_id, lot_code)
);

CREATE TABLE private.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  location_id uuid NOT NULL REFERENCES app.fulfillment_locations(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  lot_id uuid NOT NULL REFERENCES private.inventory_lots(id),
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  safety_buffer integer NOT NULL DEFAULT 0 CHECK (safety_buffer >= 0),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, location_id, variant_id, lot_id),
  CHECK (reserved <= on_hand)
);

CREATE OR REPLACE FUNCTION private.inventory_available(on_hand integer, reserved integer, safety_buffer integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT on_hand - reserved - safety_buffer;
$$;

CREATE TABLE private.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES private.inventory_balances(id),
  tx_type text NOT NULL CHECK (tx_type IN (
    'receive', 'adjust', 'reserve', 'release', 'allocate', 'import', 'expire', 'recall'
  )),
  quantity integer NOT NULL CHECK (quantity <> 0),
  reason text,
  correlation_id uuid NOT NULL,
  actor_identity_id uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION private.deny_inventory_tx_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transactions are append-only';
END;
$$;

CREATE TRIGGER trg_inventory_tx_no_update
BEFORE UPDATE ON private.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION private.deny_inventory_tx_mutation();

CREATE TRIGGER trg_inventory_tx_no_delete
BEFORE DELETE ON private.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION private.deny_inventory_tx_mutation();

CREATE TABLE private.inventory_safety_buffers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  safety_buffer integer NOT NULL CHECK (safety_buffer >= 0),
  UNIQUE (store_id, variant_id)
);

CREATE TABLE private.inventory_stockout_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  requested_qty integer NOT NULL,
  available_qty integer NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE private.inventory_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES private.inventory_balances(id),
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT inventory_adjust_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE private.inventory_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'committed', 'failed', 'reconciled')),
  preview_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, idempotency_key)
);

CREATE TABLE private.inventory_verification_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  last_verified_at timestamptz,
  due_at timestamptz NOT NULL,
  UNIQUE (store_id, variant_id)
);

GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
