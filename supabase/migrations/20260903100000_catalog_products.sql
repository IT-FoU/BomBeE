-- Migration: catalog_products
-- Apply: categories, brands, products, variants, import batches, barcode alerts
-- Rollback/recovery: restore app catalog tables from backup; keep price/media history intact

CREATE TABLE app.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES app.categories(id),
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_prohibited boolean NOT NULL DEFAULT false,
  prohibited_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.category_translations (
  category_id uuid NOT NULL REFERENCES app.categories(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('lo', 'en')),
  name text NOT NULL,
  description text,
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE app.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  evidence_storage_key text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE app.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  category_id uuid REFERENCES app.categories(id),
  brand_id uuid REFERENCES app.brands(id),
  store_product_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'active', 'paused', 'archived')),
  has_shelf_life boolean NOT NULL DEFAULT false,
  claims_authentic_brand boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz,
  UNIQUE (store_id, store_product_id)
);

CREATE TRIGGER trg_products_updated
BEFORE UPDATE ON app.products
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.product_translations (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('lo', 'en')),
  title text NOT NULL,
  description text,
  specifications text,
  warnings text,
  PRIMARY KEY (product_id, locale)
);

CREATE TABLE app.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES app.stores(id),
  sku text NOT NULL,
  barcode text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'active', 'paused', 'archived')),
  production_date date,
  expiry_date date,
  ingredients text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  archived_at timestamptz,
  UNIQUE (store_id, sku)
);

CREATE TRIGGER trg_product_variants_updated
BEFORE UPDATE ON app.product_variants
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX product_variants_barcode_idx ON app.product_variants (barcode)
  WHERE barcode IS NOT NULL;

CREATE TABLE private.barcode_duplicate_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text NOT NULL,
  variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  other_variant_id uuid NOT NULL REFERENCES app.product_variants(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  acknowledged_at timestamptz
);

CREATE TABLE private.catalog_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES app.stores(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'committed', 'rolled_back', 'failed')),
  preview_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (store_id, idempotency_key)
);

CREATE TABLE private.catalog_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES private.catalog_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'invalid', 'applied', 'rolled_back')),
  error_message text
);

-- Seed prohibited categories
INSERT INTO app.categories (slug, is_prohibited, prohibited_reason) VALUES
  ('drugs', true, 'Phase 1 prohibited'),
  ('weapons', true, 'Phase 1 prohibited'),
  ('tobacco', true, 'Phase 1 prohibited'),
  ('alcohol', true, 'Phase 1 prohibited'),
  ('illegal-goods', true, 'Phase 1 prohibited'),
  ('general', false, NULL),
  ('food', false, NULL),
  ('cosmetics', false, NULL);

INSERT INTO app.category_translations (category_id, locale, name)
SELECT id, 'en', initcap(replace(slug, '-', ' ')) FROM app.categories;

INSERT INTO app.category_translations (category_id, locale, name)
SELECT id, 'lo', slug FROM app.categories;

ALTER TABLE app.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brands FORCE ROW LEVEL SECURITY;
ALTER TABLE app.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.products FORCE ROW LEVEL SECURITY;
ALTER TABLE app.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_variants FORCE ROW LEVEL SECURITY;

CREATE POLICY categories_read ON app.categories FOR SELECT TO bombee_authenticated, bombee_anon, bombee_service USING (true);
CREATE POLICY categories_service ON app.categories FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY brands_read ON app.brands FOR SELECT TO bombee_authenticated, bombee_anon, bombee_service USING (true);
CREATE POLICY brands_service ON app.brands FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY products_service ON app.products FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY products_read_active ON app.products FOR SELECT TO bombee_authenticated, bombee_anon
  USING (status = 'active');
CREATE POLICY variants_service ON app.product_variants FOR ALL TO bombee_service USING (true) WITH CHECK (true);
CREATE POLICY variants_read_active ON app.product_variants FOR SELECT TO bombee_authenticated, bombee_anon
  USING (status = 'active');

GRANT SELECT ON app.categories, app.category_translations, app.brands TO bombee_anon, bombee_authenticated, bombee_service;
GRANT SELECT ON app.products, app.product_variants, app.product_translations TO bombee_anon, bombee_authenticated, bombee_service;
GRANT ALL ON app.categories, app.category_translations, app.brands, app.products, app.product_variants, app.product_translations TO bombee_service;
GRANT ALL ON ALL TABLES IN SCHEMA private TO bombee_service;
