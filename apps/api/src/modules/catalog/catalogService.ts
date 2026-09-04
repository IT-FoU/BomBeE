import type { PGlite } from '@electric-sql/pglite';

import {
  assertAuthenticBrandClaim,
  assertNotProhibitedCategory,
  assertShelfLifeFields,
  type LocaleCopy,
} from './rules.js';

export type ImportRow = {
  storeProductId: string;
  sku: string;
  barcode?: string;
  titleLo: string;
  titleEn: string;
  categorySlug: string;
  costLak: number;
  sellingPriceLak: number;
};

export class CatalogService {
  constructor(private readonly db: PGlite) {}

  async createBrand(input: {
    slug: string;
    name: string;
    evidenceStorageKey?: string;
    verify?: boolean;
  }) {
    const status = input.verify && input.evidenceStorageKey ? 'verified' : 'unverified';
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.brands (slug, name, verification_status, evidence_storage_key)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.slug, input.name, status, input.evidenceStorageKey ?? null],
    );
    return row.rows[0]!.id;
  }

  async createProduct(input: {
    storeId: string;
    categorySlug: string;
    brandId?: string;
    storeProductId: string;
    claimsAuthenticBrand?: boolean;
    hasShelfLife?: boolean;
    copy: LocaleCopy;
  }) {
    assertNotProhibitedCategory(input.categorySlug);
    const category = await this.db.query<{ id: string; is_prohibited: boolean }>(
      `SELECT id, is_prohibited FROM app.categories WHERE slug = $1`,
      [input.categorySlug],
    );
    const cat = category.rows[0];
    if (!cat || cat.is_prohibited) throw new Error('prohibited_category');

    if (input.claimsAuthenticBrand) {
      const brand = await this.db.query<{ verification_status: string }>(
        `SELECT verification_status FROM app.brands WHERE id = $1`,
        [input.brandId],
      );
      assertAuthenticBrandClaim({
        claimsAuthenticBrand: true,
        brandVerified: brand.rows[0]?.verification_status === 'verified',
      });
    }

    const product = await this.db.query<{ id: string }>(
      `INSERT INTO app.products
        (store_id, category_id, brand_id, store_product_id, status,
         has_shelf_life, claims_authentic_brand)
       VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING id`,
      [
        input.storeId,
        cat.id,
        input.brandId ?? null,
        input.storeProductId,
        input.hasShelfLife ?? false,
        input.claimsAuthenticBrand ?? false,
      ],
    );
    const productId = product.rows[0]!.id;
    for (const locale of ['lo', 'en'] as const) {
      const copy = input.copy[locale];
      await this.db.query(
        `INSERT INTO app.product_translations
          (product_id, locale, title, description, specifications, warnings)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          productId,
          locale,
          copy.title,
          copy.description ?? null,
          copy.specifications ?? null,
          copy.warnings ?? null,
        ],
      );
    }
    return productId;
  }

  async createVariant(input: {
    productId: string;
    storeId: string;
    sku: string;
    barcode?: string;
    attributes?: Record<string, string>;
    hasShelfLife: boolean;
    productionDate?: string;
    expiryDate?: string;
    ingredients?: string;
    warnings?: string;
  }) {
    assertShelfLifeFields({
      hasShelfLife: input.hasShelfLife,
      productionDate: input.productionDate,
      expiryDate: input.expiryDate,
      ingredients: input.ingredients,
      warnings: input.warnings,
    });

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.product_variants
        (product_id, store_id, sku, barcode, attributes, status,
         production_date, expiry_date, ingredients)
       VALUES ($1,$2,$3,$4,$5::jsonb,'draft',$6,$7,$8)
       RETURNING id`,
      [
        input.productId,
        input.storeId,
        input.sku,
        input.barcode ?? null,
        JSON.stringify(input.attributes ?? {}),
        input.productionDate ?? null,
        input.expiryDate ?? null,
        input.ingredients ?? null,
      ],
    );
    const variantId = row.rows[0]!.id;

    if (input.barcode) {
      const dupes = await this.db.query<{ id: string; store_id: string }>(
        `SELECT id, store_id FROM app.product_variants
         WHERE barcode = $1 AND id <> $2`,
        [input.barcode, variantId],
      );
      for (const other of dupes.rows) {
        if (other.store_id !== input.storeId) {
          await this.db.query(
            `INSERT INTO private.barcode_duplicate_alerts
              (barcode, variant_id, other_variant_id)
             VALUES ($1,$2,$3)`,
            [input.barcode, variantId, other.id],
          );
        }
      }
    }

    return variantId;
  }

  async setStatus(
    table: 'products' | 'product_variants',
    id: string,
    status: 'draft' | 'pending_approval' | 'active' | 'paused' | 'archived',
  ) {
    const archivedAt = status === 'archived' ? new Date().toISOString() : null;
    await this.db.query(
      `UPDATE app.${table}
       SET status = $2, archived_at = $3, updated_at = timezone('utc', now())
       WHERE id = $1`,
      [id, status, archivedAt],
    );
  }

  async listCategories(): Promise<
    Array<{ id: string; slug: string; nameLo: string; nameEn: string; prohibited: boolean }>
  > {
    const row = await this.db.query<{
      id: string;
      slug: string;
      is_prohibited: boolean;
      name_lo: string | null;
      name_en: string | null;
    }>(
      `SELECT c.id, c.slug, c.is_prohibited,
              lo.name AS name_lo, en.name AS name_en
       FROM app.categories c
       LEFT JOIN app.category_translations lo ON lo.category_id = c.id AND lo.locale = 'lo'
       LEFT JOIN app.category_translations en ON en.category_id = c.id AND en.locale = 'en'
       WHERE c.is_prohibited = false
       ORDER BY c.slug`,
    );
    return row.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      nameLo: r.name_lo ?? r.slug,
      nameEn: r.name_en ?? r.slug,
      prohibited: r.is_prohibited,
    }));
  }

  async listActiveProducts(limit = 50): Promise<
    Array<{
      id: string;
      slug: string;
      titleLo: string;
      titleEn: string;
      storeId: string;
      storeName: string;
      brandId: string | null;
      brandName: string | null;
      categoryId: string;
      categorySlug: string;
      categoryLo: string;
      categoryEn: string;
      priceLak: number;
      compareAtLak: number | null;
      variants: Array<{ id: string; label: string; priceLak: number; sku: string }>;
    }>
  > {
    const products = await this.db.query<{
      id: string;
      store_id: string;
      store_name: string;
      brand_id: string | null;
      brand_name: string | null;
      category_id: string;
      category_slug: string;
      category_lo: string | null;
      category_en: string | null;
      title_lo: string | null;
      title_en: string | null;
      store_product_id: string;
    }>(
      `SELECT p.id, p.store_id, s.name AS store_name, p.brand_id, b.name AS brand_name,
              p.category_id, c.slug AS category_slug,
              clo.name AS category_lo, cen.name AS category_en,
              tlo.title AS title_lo, ten.title AS title_en,
              p.store_product_id
       FROM app.products p
       JOIN app.stores s ON s.id = p.store_id
       JOIN app.categories c ON c.id = p.category_id
       LEFT JOIN app.brands b ON b.id = p.brand_id
       LEFT JOIN app.category_translations clo ON clo.category_id = c.id AND clo.locale = 'lo'
       LEFT JOIN app.category_translations cen ON cen.category_id = c.id AND cen.locale = 'en'
       LEFT JOIN app.product_translations tlo ON tlo.product_id = p.id AND tlo.locale = 'lo'
       LEFT JOIN app.product_translations ten ON ten.product_id = p.id AND ten.locale = 'en'
       WHERE p.status = 'active'
       ORDER BY p.created_at DESC
       LIMIT $1`,
      [limit],
    );

    const out: Array<{
      id: string;
      slug: string;
      titleLo: string;
      titleEn: string;
      storeId: string;
      storeName: string;
      brandId: string | null;
      brandName: string | null;
      categoryId: string;
      categorySlug: string;
      categoryLo: string;
      categoryEn: string;
      priceLak: number;
      compareAtLak: number | null;
      variants: Array<{ id: string; label: string; priceLak: number; sku: string }>;
    }> = [];

    for (const p of products.rows) {
      const variants = await this.db.query<{
        id: string;
        sku: string;
        selling_price_lak: number | null;
        compare_at_price_lak: number | null;
      }>(
        `SELECT v.id, v.sku,
                pv.selling_price_lak, pv.compare_at_price_lak
         FROM app.product_variants v
         LEFT JOIN LATERAL (
           SELECT selling_price_lak, compare_at_price_lak
           FROM finance.price_versions
           WHERE variant_id = v.id AND status = 'approved'
           ORDER BY version_no DESC
           LIMIT 1
         ) pv ON true
         WHERE v.product_id = $1 AND v.status = 'active'
         ORDER BY v.sku`,
        [p.id],
      );
      const mapped = variants.rows.map((v) => ({
        id: v.id,
        label: v.sku,
        priceLak: Number(v.selling_price_lak ?? 0),
        sku: v.sku,
      }));
      const primary = mapped[0];
      out.push({
        id: p.id,
        slug: p.store_product_id,
        titleLo: p.title_lo ?? p.store_product_id,
        titleEn: p.title_en ?? p.store_product_id,
        storeId: p.store_id,
        storeName: p.store_name,
        brandId: p.brand_id,
        brandName: p.brand_name,
        categoryId: p.category_id,
        categorySlug: p.category_slug,
        categoryLo: p.category_lo ?? p.category_slug,
        categoryEn: p.category_en ?? p.category_slug,
        priceLak: primary?.priceLak ?? 0,
        compareAtLak: variants.rows[0]?.compare_at_price_lak
          ? Number(variants.rows[0].compare_at_price_lak)
          : null,
        variants: mapped,
      });
    }
    return out;
  }

  async previewImport(input: {
    storeId: string;
    idempotencyKey: string;
    rows: ImportRow[];
    createdBy?: string;
  }) {
    const existing = await this.db.query<{ id: string; status: string; preview_report: unknown }>(
      `SELECT id, status, preview_report FROM private.catalog_import_batches
       WHERE store_id = $1 AND idempotency_key = $2`,
      [input.storeId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return {
        batchId: existing.rows[0].id,
        idempotentReplay: true as const,
        report: existing.rows[0].preview_report,
      };
    }

    const batch = await this.db.query<{ id: string }>(
      `INSERT INTO private.catalog_import_batches
        (store_id, idempotency_key, status, created_by)
       VALUES ($1,$2,'preview',$3) RETURNING id`,
      [input.storeId, input.idempotencyKey, input.createdBy ?? null],
    );
    const batchId = batch.rows[0]!.id;
    const errors: Array<{ row: number; error: string }> = [];
    let valid = 0;

    for (const [index, row] of input.rows.entries()) {
      const rowNumber = index + 1;
      let status: 'valid' | 'invalid' = 'valid';
      let errorMessage: string | null = null;
      try {
        assertNotProhibitedCategory(row.categorySlug);
        if (!row.sku || !row.storeProductId) throw new Error('sku_and_store_product_id_required');
        if (!Number.isInteger(row.costLak) || !Number.isInteger(row.sellingPriceLak)) {
          throw new Error('prices_must_be_integer_lak');
        }
        valid += 1;
      } catch (error) {
        status = 'invalid';
        errorMessage = error instanceof Error ? error.message : 'invalid_row';
        errors.push({ row: rowNumber, error: errorMessage });
      }
      await this.db.query(
        `INSERT INTO private.catalog_import_rows
          (batch_id, row_number, payload, status, error_message)
         VALUES ($1,$2,$3::jsonb,$4,$5)`,
        [batchId, rowNumber, JSON.stringify(row), status, errorMessage],
      );
    }

    const report = { valid, invalid: errors.length, errors };
    await this.db.query(
      `UPDATE private.catalog_import_batches
       SET preview_report = $2::jsonb, error_report = $3::jsonb
       WHERE id = $1`,
      [batchId, JSON.stringify(report), JSON.stringify(errors)],
    );
    return { batchId, idempotentReplay: false as const, report };
  }

  async commitImport(batchId: string) {
    const batch = await this.db.query<{
      id: string;
      store_id: string;
      status: string;
      preview_report: { invalid?: number };
    }>(
      `SELECT id, store_id, status, preview_report
       FROM private.catalog_import_batches WHERE id = $1`,
      [batchId],
    );
    const current = batch.rows[0];
    if (!current) throw new Error('batch_not_found');
    if (current.status === 'committed') return { ok: true as const, replay: true };
    if ((current.preview_report?.invalid ?? 0) > 0) {
      await this.db.query(
        `UPDATE private.catalog_import_batches SET status = 'failed' WHERE id = $1`,
        [batchId],
      );
      await this.rollbackImport(batchId);
      return { ok: false as const, reason: 'invalid_rows' };
    }

    const rows = await this.db.query<{ payload: ImportRow }>(
      `SELECT payload FROM private.catalog_import_rows
       WHERE batch_id = $1 AND status = 'valid' ORDER BY row_number`,
      [batchId],
    );

    try {
      for (const row of rows.rows) {
        const payload = row.payload;
        const productId = await this.createProduct({
          storeId: current.store_id,
          categorySlug: payload.categorySlug,
          storeProductId: payload.storeProductId,
          copy: {
            lo: { title: payload.titleLo },
            en: { title: payload.titleEn },
          },
        });
        await this.createVariant({
          productId,
          storeId: current.store_id,
          sku: payload.sku,
          barcode: payload.barcode,
          hasShelfLife: false,
        });
      }
      await this.db.query(
        `UPDATE private.catalog_import_batches SET status = 'committed' WHERE id = $1`,
        [batchId],
      );
      await this.db.query(
        `UPDATE private.catalog_import_rows SET status = 'applied'
         WHERE batch_id = $1 AND status = 'valid'`,
        [batchId],
      );
      return { ok: true as const, replay: false };
    } catch (error) {
      await this.rollbackImport(batchId);
      await this.db.query(
        `UPDATE private.catalog_import_batches SET status = 'failed' WHERE id = $1`,
        [batchId],
      );
      throw error;
    }
  }

  async rollbackImport(batchId: string) {
    await this.db.query(
      `UPDATE private.catalog_import_rows SET status = 'rolled_back'
       WHERE batch_id = $1 AND status IN ('valid', 'applied', 'pending')`,
      [batchId],
    );
    await this.db.query(
      `UPDATE private.catalog_import_batches SET status = 'rolled_back' WHERE id = $1`,
      [batchId],
    );
  }
}
