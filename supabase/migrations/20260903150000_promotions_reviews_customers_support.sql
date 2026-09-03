-- Migration: promotions_reviews_customers_support
-- Apply: promotions, reviews/tiktok, customer privacy, support tickets
-- Rollback/recovery: restore app/content/support tables; keep order promotion snapshots

CREATE TABLE app.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title_lo text NOT NULL,
  title_en text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'exhausted', 'ended')),
  percent_off integer CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  amount_off_lak bigint CHECK (amount_off_lak IS NULL OR amount_off_lak > 0),
  stacking_group text NOT NULL DEFAULT 'default',
  allow_stack boolean NOT NULL DEFAULT false,
  funding text NOT NULL CHECK (funding IN ('platform', 'supplier', 'split')),
  platform_fund_bps integer NOT NULL DEFAULT 10000
    CHECK (platform_fund_bps >= 0 AND platform_fund_bps <= 10000),
  budget_lak bigint NOT NULL CHECK (budget_lak > 0),
  quantity_cap integer CHECK (quantity_cap IS NULL OR quantity_cap > 0),
  spent_lak bigint NOT NULL DEFAULT 0 CHECK (spent_lak >= 0),
  redeemed_count integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  alert_80_sent boolean NOT NULL DEFAULT false,
  alert_90_sent boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NOT NULL,
  scope jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  CHECK (effective_to > effective_from),
  CHECK (
    (percent_off IS NOT NULL AND amount_off_lak IS NULL)
    OR (percent_off IS NULL AND amount_off_lak IS NOT NULL)
  ),
  CHECK (
    (funding = 'split' AND platform_fund_bps BETWEEN 1 AND 9999)
    OR (funding = 'platform' AND platform_fund_bps = 10000)
    OR (funding = 'supplier' AND platform_fund_bps = 0)
  )
);

CREATE TABLE app.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES app.promotions(id),
  parent_order_id uuid NOT NULL REFERENCES app.parent_orders(id),
  amount_lak bigint NOT NULL CHECK (amount_lak > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.promotion_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES app.promotions(id),
  threshold_pct integer NOT NULL CHECK (threshold_pct IN (80, 90)),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (promotion_id, threshold_pct)
);

CREATE TABLE app.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id),
  child_order_id uuid NOT NULL REFERENCES app.child_orders(id),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body_lo text,
  body_en text,
  verified_purchase boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden', 'deleted')),
  delivered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (child_order_id, product_id, customer_identity_id)
);

CREATE TABLE app.product_review_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES app.product_reviews(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  rating integer NOT NULL,
  body_lo text,
  body_en text,
  edited_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (review_id, version_no)
);

CREATE TABLE app.product_review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES app.product_reviews(id),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  approved_at timestamptz,
  approved_by uuid REFERENCES security.auth_identities(id)
);

CREATE TABLE app.tiktok_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  product_id uuid REFERENCES app.products(id),
  submitted_by_type text NOT NULL CHECK (submitted_by_type IN ('staff', 'supplier', 'customer')),
  submitted_by uuid REFERENCES security.auth_identities(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'rejected', 'hidden_suspicious')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  moderation_note text
);

CREATE TABLE app.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  label text NOT NULL DEFAULT 'home',
  recipient_name text NOT NULL,
  recipient_phone_e164 text NOT NULL,
  address_line text NOT NULL,
  district text,
  province text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz
);

CREATE UNIQUE INDEX customer_one_default_address
  ON app.customer_addresses (customer_identity_id)
  WHERE is_default = true AND archived_at IS NULL;

CREATE TABLE app.order_address_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL UNIQUE REFERENCES app.parent_orders(id),
  recipient_name text NOT NULL,
  recipient_phone_e164 text NOT NULL,
  address_line text NOT NULL,
  district text,
  province text,
  snapped_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION app.deny_order_address_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_address_snapshots are immutable';
END;
$$;

CREATE TRIGGER trg_order_address_snapshots_immutable
BEFORE UPDATE OR DELETE ON app.order_address_snapshots
FOR EACH ROW EXECUTE FUNCTION app.deny_order_address_mutation();

CREATE TABLE app.account_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claimed_phone_e164 text NOT NULL,
  document_storage_key text NOT NULL,
  document_encrypted boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  decided_at timestamptz,
  decided_by uuid REFERENCES security.auth_identities(id)
);

CREATE TABLE app.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  otp_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  approved_by uuid REFERENCES security.auth_identities(id),
  completed_at timestamptz
);

CREATE TABLE app.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_identity_id uuid NOT NULL REFERENCES security.auth_identities(id),
  channel text NOT NULL CHECK (channel IN ('in_app', 'whatsapp', 'phone')),
  external_ref text,
  subject text NOT NULL,
  urgency text NOT NULL DEFAULT 'general'
    CHECK (urgency IN ('general', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'awaiting_customer', 'resolved_pending_confirm', 'closed', 'reopened'
    )),
  first_response_due_at timestamptz NOT NULL,
  resolution_due_at timestamptz NOT NULL,
  first_responded_at timestamptz,
  preliminary_resolved_at timestamptz,
  escalated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES app.support_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'staff', 'system')),
  sender_identity_id uuid REFERENCES security.auth_identities(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.support_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES app.support_tickets(id),
  reason text NOT NULL,
  notified_roles text[] NOT NULL DEFAULT ARRAY['team_lead']::text[],
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

GRANT ALL ON app.promotions, app.promotion_redemptions, app.promotion_alerts,
  app.product_reviews, app.product_review_versions, app.product_review_responses,
  app.tiktok_links, app.customer_addresses, app.order_address_snapshots,
  app.account_recovery_requests, app.account_deletion_requests,
  app.support_tickets, app.support_messages, app.support_escalations
  TO bombee_service;
