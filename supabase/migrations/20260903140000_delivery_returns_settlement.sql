-- Migration: delivery_returns_settlement
-- Apply: couriers, delivery handoff/POD, returns/refunds SLA, recalls, settlements
-- Rollback/recovery: restore fulfillment/finance settlement tables; never rewrite ledger lines

CREATE TABLE app.couriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.courier_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES app.couriers(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  pod_methods text[] NOT NULL DEFAULT ARRAY['otp','signature','photo','api']::text[],
  lost_liability_party text NOT NULL
    CHECK (lost_liability_party IN ('courier', 'platform', 'store', 'shared')),
  damaged_liability_party text NOT NULL
    CHECK (damaged_liability_party IN ('courier', 'platform', 'store', 'shared')),
  compensation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT timezone('utc', now()),
  effective_to timestamptz,
  UNIQUE (courier_id, version_no),
  CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE TABLE app.shipment_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL UNIQUE REFERENCES app.shipments(id),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  courier_id uuid NOT NULL REFERENCES app.couriers(id),
  courier_contract_id uuid NOT NULL REFERENCES app.courier_contracts(id),
  channel text NOT NULL CHECK (channel IN ('manual', 'api')),
  tracking_number text NOT NULL,
  package_photo_key text,
  handoff_at timestamptz,
  pod_method text CHECK (pod_method IN ('otp', 'signature', 'photo', 'api')),
  pod_evidence_key text,
  delivered_at timestamptz,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created', 'handed_off', 'in_transit', 'delivered', 'failed', 'claim_open'
    )),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX shipment_deliveries_tracking_uniq
  ON app.shipment_deliveries (courier_id, tracking_number);

CREATE TABLE app.packing_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL UNIQUE REFERENCES app.child_orders(id),
  confirmed_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  packed_at timestamptz,
  late boolean NOT NULL DEFAULT false,
  alerted_at timestamptz
);

CREATE TABLE app.delivery_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_delivery_id uuid NOT NULL REFERENCES app.shipment_deliveries(id),
  claim_type text NOT NULL CHECK (claim_type IN ('lost', 'damaged')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'platform_coordinating', 'resolved', 'rejected')),
  liability_party text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz
);

CREATE TABLE app.return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  reason text NOT NULL CHECK (reason IN (
    'defective', 'wrong_item', 'incomplete', 'materially_not_described', 'change_of_mind'
  )),
  delivered_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  shipping_liability text
    CHECK (shipping_liability IN ('store', 'courier', 'customer', 'admin_decision')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  evidence_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  communications jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES security.auth_identities(id)
);

CREATE TABLE app.refund_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL UNIQUE REFERENCES app.refund_requests(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_at timestamptz,
  sla_due_at timestamptz,
  paid_at timestamptz,
  payment_refund_id uuid REFERENCES finance.payment_refunds(id),
  CONSTRAINT refund_approval_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE app.product_recalls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id),
  lot_id uuid REFERENCES private.inventory_lots(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  store_bears_cost boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  completed_at timestamptz
);

CREATE TABLE app.recall_affected_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_id uuid NOT NULL REFERENCES app.product_recalls(id),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  contact_status text NOT NULL DEFAULT 'pending'
    CHECK (contact_status IN ('pending', 'contacted', 'unreachable')),
  resolution text NOT NULL DEFAULT 'pending'
    CHECK (resolution IN ('pending', 'refund', 'replacement', 'declined')),
  UNIQUE (recall_id, child_order_id)
);

CREATE TABLE finance.settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'custom')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'paid', 'partially_disputed')),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  payout_account_version_id uuid REFERENCES finance.payout_account_versions(id),
  gross_lak bigint NOT NULL DEFAULT 0,
  held_lak bigint NOT NULL DEFAULT 0,
  net_lak bigint NOT NULL DEFAULT 0,
  carry_forward_lak bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  approved_at timestamptz,
  paid_at timestamptz,
  CHECK (period_end > period_start),
  CONSTRAINT settlement_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE finance.settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES finance.settlement_batches(id) ON DELETE CASCADE,
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  payment_request_id uuid REFERENCES finance.payment_requests(id),
  amount_lak bigint NOT NULL CHECK (amount_lak <> 0),
  held boolean NOT NULL DEFAULT false,
  hold_reason text,
  disputed boolean NOT NULL DEFAULT false,
  UNIQUE (batch_id, child_order_id)
);

CREATE TABLE finance.settlement_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES finance.settlement_batches(id),
  settlement_line_id uuid NOT NULL REFERENCES finance.settlement_lines(id),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected')),
  opened_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz
);

CREATE TABLE finance.store_balance_carryforward (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  amount_lak bigint NOT NULL CHECK (amount_lak <> 0),
  source_batch_id uuid REFERENCES finance.settlement_batches(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'applied', 'collected')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE finance.collection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  carryforward_id uuid NOT NULL REFERENCES finance.store_balance_carryforward(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION finance.deny_settlement_line_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement_lines cannot be deleted';
  END IF;
  IF OLD.child_order_id IS DISTINCT FROM NEW.child_order_id
     OR OLD.amount_lak IS DISTINCT FROM NEW.amount_lak
     OR OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id THEN
    RAISE EXCEPTION 'settlement line identity/amount fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_lines_immutable_core
BEFORE UPDATE OR DELETE ON finance.settlement_lines
FOR EACH ROW EXECUTE FUNCTION finance.deny_settlement_line_mutation();

GRANT ALL ON app.couriers, app.courier_contracts, app.shipment_deliveries,
  app.packing_deadlines, app.delivery_claims, app.return_requests,
  app.refund_approvals, app.product_recalls, app.recall_affected_orders
  TO bombee_service;

GRANT ALL ON finance.settlement_batches, finance.settlement_lines,
  finance.settlement_disputes, finance.store_balance_carryforward,
  finance.collection_requests TO bombee_service;
