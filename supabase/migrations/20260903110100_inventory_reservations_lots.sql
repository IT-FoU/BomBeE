-- Migration: inventory_reservations_lots
-- Apply: reservations, lot shelf-life policies, expiry alerts linked to discount requests
-- Rollback/recovery: restore reservation/lot policy tables; keep ledger history

CREATE TABLE private.category_shelf_life_policies (
  category_slug text PRIMARY KEY,
  requires_lot boolean NOT NULL DEFAULT true,
  min_remaining_days integer NOT NULL DEFAULT 90 CHECK (min_remaining_days >= 0)
);

INSERT INTO private.category_shelf_life_policies (category_slug, requires_lot, min_remaining_days) VALUES
  ('food', true, 90),
  ('cosmetics', true, 90),
  ('general', false, 90);

CREATE TABLE private.lot_expiry_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES private.inventory_lots(id),
  alert_type text NOT NULL CHECK (alert_type IN ('near_minimum', 'expired')),
  remaining_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  discount_request_id uuid REFERENCES finance.near_expiry_discount_requests(id)
);

CREATE TABLE private.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES private.inventory_balances(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reservation_type text NOT NULL CHECK (reservation_type IN ('qr', 'cod')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'consumed', 'expired')),
  payment_deadline_at timestamptz,
  expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  released_at timestamptz,
  CHECK (
    (reservation_type = 'qr' AND payment_deadline_at IS NOT NULL AND expires_at IS NOT NULL)
    OR (reservation_type = 'cod')
  )
);

CREATE INDEX inventory_reservations_balance_active_idx
  ON private.inventory_reservations (balance_id)
  WHERE status = 'active';

GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
