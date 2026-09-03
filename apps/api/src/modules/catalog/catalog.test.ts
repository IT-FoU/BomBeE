import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from './catalogService.js';
import { MediaService } from './mediaService.js';
import { PricingService } from './pricingService.js';
import { MEDIA_LIMITS, validateMediaUpload } from './rules.js';

describe('Milestone 3 catalog', () => {
  let db: PGlite;
  let catalog: CatalogService;
  let media: MediaService;
  let pricing: PricingService;
  let storeId: string;
  let otherStoreId: string;
  let makerId: string;
  let ownerId: string;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    makerId = (await identity.ensureStaff('staff:catalog-m3', 'Catalog', '+8562084000001'))
      .identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m3', 'Owner', '+8562084000002')).identityId;
    const stores = new StoreService(db);
    storeId = await stores.createStore({ code: 'CAT01', name: 'Catalog Store' });
    otherStoreId = await stores.createStore({ code: 'CAT02', name: 'Other Store' });
    catalog = new CatalogService(db);
    media = new MediaService(db);
    pricing = new PricingService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('supports CRUD/archive with Lao/English copy and blocks prohibited categories', async () => {
    await expect(
      catalog.createProduct({
        storeId,
        categorySlug: 'alcohol',
        storeProductId: 'SP-AL',
        copy: { lo: { title: 'ເບຍ' }, en: { title: 'Beer' } },
      }),
    ).rejects.toThrow(/prohibited_category/);

    const brandId = await catalog.createBrand({
      slug: 'demo-brand',
      name: 'Demo Brand',
      evidenceStorageKey: 'private/brand/evidence.pdf',
      verify: true,
    });

    productId = await catalog.createProduct({
      storeId,
      categorySlug: 'food',
      brandId,
      storeProductId: 'SP-WATER',
      claimsAuthenticBrand: true,
      hasShelfLife: true,
      copy: {
        lo: {
          title: 'ນ້ຳດື່ມ',
          description: 'ນ້ຳດື່ມບໍລິສຸດ',
          warnings: 'ເກັບໃນທີ່ແຫ້ງ',
        },
        en: {
          title: 'Drinking Water',
          description: 'Purified water',
          warnings: 'Store in a dry place',
        },
      },
    });

    variantId = await catalog.createVariant({
      productId,
      storeId,
      sku: 'WATER-1L',
      barcode: '8850001111111',
      hasShelfLife: true,
      productionDate: '2026-01-01',
      expiryDate: '2027-01-01',
      ingredients: 'water',
      warnings: 'Store cool',
    });

    await catalog.setStatus('products', productId, 'active');
    await catalog.setStatus('product_variants', variantId, 'active');
    await catalog.setStatus('product_variants', variantId, 'archived');

    const archived = await db.query<{ status: string }>(
      `SELECT status FROM app.product_variants WHERE id = $1`,
      [variantId],
    );
    expect(archived.rows[0]?.status).toBe('archived');

    const titles = await db.query<{ locale: string; title: string }>(
      `SELECT locale, title FROM app.product_translations WHERE product_id = $1 ORDER BY locale`,
      [productId],
    );
    expect(titles.rows.map((r) => r.title)).toEqual(['Drinking Water', 'ນ້ຳດື່ມ']);
  });

  it('alerts on cross-store barcode duplicates and enforces SKU uniqueness', async () => {
    const otherProduct = await catalog.createProduct({
      storeId: otherStoreId,
      categorySlug: 'general',
      storeProductId: 'SP-WATER-2',
      copy: { lo: { title: 'ນ້ຳ' }, en: { title: 'Water' } },
    });
    await catalog.createVariant({
      productId: otherProduct,
      storeId: otherStoreId,
      sku: 'WATER-1L',
      barcode: '8850001111111',
      hasShelfLife: false,
    });
    const alerts = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM private.barcode_duplicate_alerts WHERE barcode = $1`,
      ['8850001111111'],
    );
    expect(alerts.rows[0]?.n).toBeGreaterThanOrEqual(1);

    await expect(
      catalog.createVariant({
        productId,
        storeId,
        sku: 'WATER-1L',
        hasShelfLife: false,
      }),
    ).rejects.toThrow();
  });

  it('previews imports idempotently and rolls back invalid batches', async () => {
    const rows = [
      {
        storeProductId: 'IMP-1',
        sku: 'IMP-SKU-1',
        titleLo: 'ສິນຄ້າ',
        titleEn: 'Item',
        categorySlug: 'general',
        costLak: 1000,
        sellingPriceLak: 1500,
      },
      {
        storeProductId: 'IMP-BAD',
        sku: 'IMP-SKU-BAD',
        titleLo: 'ເຫຼົ້າ',
        titleEn: 'Alcohol',
        categorySlug: 'alcohol',
        costLak: 1000,
        sellingPriceLak: 1500,
      },
    ];

    const preview = await catalog.previewImport({
      storeId,
      idempotencyKey: 'import-1',
      rows,
      createdBy: makerId,
    });
    expect(preview.report).toMatchObject({ valid: 1, invalid: 1 });

    const replay = await catalog.previewImport({
      storeId,
      idempotencyKey: 'import-1',
      rows,
      createdBy: makerId,
    });
    expect(replay.idempotentReplay).toBe(true);

    const commitBad = await catalog.commitImport(preview.batchId);
    expect(commitBad).toEqual({ ok: false, reason: 'invalid_rows' });

    const good = await catalog.previewImport({
      storeId,
      idempotencyKey: 'import-2',
      rows: [rows[0]!],
      createdBy: makerId,
    });
    const committed = await catalog.commitImport(good.batchId);
    expect(committed).toEqual({ ok: true, replay: false });
  });

  it('validates media uploads and issues signed URLs only for passed media', async () => {
    expect(
      validateMediaUpload({
        mediaType: 'video',
        mimeType: 'video/mp4',
        byteSize: MEDIA_LIMITS.video.maxBytes + 1,
        durationSeconds: 30,
      }).ok,
    ).toBe(false);

    const uploaded = await media.upload({
      productId,
      mediaType: 'image',
      mimeType: 'image/jpeg',
      byteSize: 120_000,
      widthPx: 800,
      heightPx: 800,
    });
    expect(uploaded.thumbnailKey).toContain('.thumb.');

    const signed = await media.issueSignedUrl({
      mediaId: uploaded.id,
      actorIdentityId: makerId,
    });
    expect(signed.token).toHaveLength(64);
  });

  it('requires approval before price is active and blocks below-cost without Owner 2FA', async () => {
    // revive variant for pricing
    await catalog.setStatus('product_variants', variantId, 'active');

    const proposed = await pricing.proposePrice({
      variantId,
      costLak: 5000,
      sellingPriceLak: 7000,
      makerIdentityId: makerId,
      reason: 'launch price',
    });
    expect(proposed.status).toBe('pending');
    expect(await pricing.activePrice(variantId)).toBeNull();

    expect(
      await pricing.approvePrice({
        requestId: proposed.requestId,
        approverIdentityId: makerId,
        actorRoles: ['catalog'],
        stepUpVerified: false,
      }),
    ).toEqual({ ok: false, reason: 'self_approval' });

    const approved = await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    expect(approved.ok).toBe(true);
    expect((await pricing.activePrice(variantId))?.selling_price_lak).toBe(7000);

    const below = await pricing.proposePrice({
      variantId,
      costLak: 5000,
      sellingPriceLak: 4000,
      makerIdentityId: makerId,
      reason: 'clearance campaign',
    });
    expect(below.belowCost).toBe(true);
    expect(
      await pricing.approvePrice({
        requestId: below.requestId,
        approverIdentityId: ownerId,
        actorRoles: ['owner'],
        stepUpVerified: false,
      }),
    ).toEqual({ ok: false, reason: '2fa_required' });

    const belowOk = await pricing.approvePrice({
      requestId: below.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: true,
    });
    expect(belowOk.ok).toBe(true);

    const discountId = await pricing.requestNearExpiryDiscount({
      variantId,
      proposedSellingPriceLak: 3500,
      reason: 'expires in 20 days',
      makerIdentityId: makerId,
    });
    expect(discountId).toBeTruthy();
  });
});
