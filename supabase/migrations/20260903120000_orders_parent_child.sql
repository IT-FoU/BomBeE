-- Migration: orders_parent_child
-- Apply: carts, parent/child orders, immutable item snapshots, documents, transitions
-- Rollback/recovery: restore order tables from backup; never rewrite item snapshots

CREATE TABLE app.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES app.carts(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES app.stores(id),
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE app.parent_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending_supplier',
  currency text NOT NULL DEFAULT 'LAK' CHECK (currency = 'LAK'),
  subtotal_lak bigint NOT NULL DEFAULT 0 CHECK (subtotal_lak >= 0),
  discount_lak bigint NOT NULL DEFAULT 0 CHECK (discount_lak >= 0),
  shipping_lak bigint NOT NULL DEFAULT 0 CHECK (shipping_lak >= 0),
  total_lak bigint NOT NULL DEFAULT 0 CHECK (total_lak >= 0),
  cancellation_note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.child_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL REFERENCES app.parent_orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES app.stores(id),
  child_order_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_supplier',
  subtotal_lak bigint NOT NULL DEFAULT 0 CHECK (subtotal_lak >= 0),
  discount_lak bigint NOT NULL DEFAULT 0 CHECK (discount_lak >= 0),
  shipping_lak bigint NOT NULL DEFAULT 0 CHECK (shipping_lak >= 0),
  total_lak bigint NOT NULL DEFAULT 0 CHECK (total_lak >= 0),
  payment_received boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (parent_order_id, store_id)
);

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  sku text NOT NULL,
  title_lo text NOT NULL,
  title_en text NOT NULL,
  unit_price_lak bigint NOT NULL CHECK (unit_price_lak >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_lak bigint NOT NULL CHECK (line_total_lak >= 0),
  promo_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION app.deny_order_item_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_items are immutable snapshots';
  END IF;
  IF OLD.variant_id IS DISTINCT FROM NEW.variant_id
     OR OLD.sku IS DISTINCT FROM NEW.sku
     OR OLD.unit_price_lak IS DISTINCT FROM NEW.unit_price_lak
     OR OLD.title_lo IS DISTINCT FROM NEW.title_lo
     OR OLD.title_en IS DISTINCT FROM NEW.title_en THEN
    RAISE EXCEPTION 'order item snapshot fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_items_immutable
BEFORE UPDATE OR DELETE ON app.order_items
FOR EACH ROW EXECUTE FUNCTION app.deny_order_item_mutation();

CREATE TABLE app.order_status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_identity_id uuid REFERENCES security.auth_identities(id),
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (child_order_id, from_status, to_status, correlation_id)
);

CREATE TABLE app.order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid REFERENCES app.parent_orders(id),
  child_order_id uuid REFERENCES app.child_orders(id),
  doc_type text NOT NULL CHECK (doc_type IN ('combined_summary', 'store_summary')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (parent_order_id IS NOT NULL OR child_order_id IS NOT NULL)
);

CREATE TABLE app.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'handed_off', 'in_transit', 'delivered', 'failed')),
  requires_admin_approval boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES app.shipments(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES app.order_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE (shipment_id, order_item_id)
);

CREATE TABLE app.split_shipment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  maker_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approver_identity_id uuid REFERENCES security.auth_identities(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  CONSTRAINT split_no_self CHECK (
    approver_identity_id IS NULL OR approver_identity_id <> maker_identity_id
  )
);

CREATE TABLE app.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.cancellation_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL REFERENCES app.parent_orders(id),
  scope text NOT NULL CHECK (scope IN ('item', 'store', 'order')),
  payload jsonb NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE app.parent_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.parent_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE app.child_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.child_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE app.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_items FORCE ROW LEVEL SECURITY;

CREATE POLICY parent_orders_service ON app.parent_orders FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY child_orders_service ON app.child_orders FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY order_items_service ON app.order_items FOR ALL TO bombee_service USING (true) WITH CHECK (true);

GRANT ALL ON app.carts, app.cart_items, app.parent_orders, app.child_orders, app.order_items,
  app.order_status_transitions, app.order_documents, app.shipments, app.shipment_items,
  app.split_shipment_requests, app.refund_requests, app.cancellation_previews TO bombee_service;
