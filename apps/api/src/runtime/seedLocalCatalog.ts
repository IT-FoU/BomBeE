import type { PGlite } from '@electric-sql/pglite';

import { CatalogService } from '../modules/catalog/catalogService.js';
import { PricingService } from '../modules/catalog/pricingService.js';
import { DeliveryService } from '../modules/fulfillment/deliveryService.js';
import { IdentityService } from '../modules/identity/service.js';
import { MockSmsProvider } from '../modules/identity/otp.js';
import { InventoryService } from '../modules/inventory/inventoryService.js';
import { StoreService } from '../modules/stores/storeService.js';

async function ensureMockCourier(db: PGlite): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM app.couriers WHERE code = 'LOCAL-MOCK' LIMIT 1`,
  );
  if (existing.rows[0]) return;
  const delivery = new DeliveryService(db);
  await delivery.createCourier({
    code: 'LOCAL-MOCK',
    name: 'Local Mock Courier',
  });
}

/** Seed a tiny active catalog + stock for local API browse (mock only). */
export async function seedLocalCatalog(db: PGlite): Promise<void> {
  await ensureMockCourier(db);

  const existing = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.products WHERE status = 'active'`,
  );
  if ((existing.rows[0]?.n ?? 0) > 0) return;

  const identity = new IdentityService(db, new MockSmsProvider());
  const stores = new StoreService(db);
  const catalog = new CatalogService(db);
  const pricing = new PricingService(db);
  const inventory = new InventoryService(db);

  const maker = await identity.ensureStaff('staff:local-catalog-maker', 'Catalog Maker', '+8562087000001');
  const owner = await identity.ensureStaff('staff:local-catalog-owner', 'Catalog Owner', '+8562087000002');

  const storeFresh = await stores.createStore({ code: 'LOCAL-FRESH', name: 'VTE Fresh Mart' });
  const storeHome = await stores.createStore({ code: 'LOCAL-HOME', name: 'Lane Xang Home' });

  async function activateStore(storeId: string) {
    for (const docType of ['owner_id', 'store_info', 'bank_account', 'contract'] as const) {
      const docId = await stores.uploadDocument({
        storeId,
        docType,
        storageKey: `private/${storeId}/${docType}.pdf`,
        expiresAt: '2027-12-31',
      });
      await stores.verifyDocument(docId, storeId);
    }
    const locationId = await stores.addFulfillmentLocation({
      storeId,
      name: 'Main',
      addressLine: 'Vientiane',
      active: true,
    });
    await stores.activateIfReady(storeId);
    return locationId;
  }

  const locationFresh = await activateStore(storeFresh);
  const locationHome = await activateStore(storeHome);
  const brandWater = await catalog.createBrand({
    slug: 'mekong-pure',
    name: 'Mekong Pure',
    evidenceStorageKey: 'local/mekong-pure.pdf',
    verify: true,
  });
  const brandHome = await catalog.createBrand({
    slug: 'housecraft',
    name: 'HouseCraft',
    evidenceStorageKey: 'local/housecraft.pdf',
    verify: true,
  });

  async function sellable(input: {
    storeId: string;
    locationId: string;
    categorySlug: string;
    brandId: string;
    storeProductId: string;
    sku: string;
    titleLo: string;
    titleEn: string;
    costLak: number;
    sellingPriceLak: number;
    compareAtPriceLak?: number;
    receiveQty: number;
  }) {
    const productId = await catalog.createProduct({
      storeId: input.storeId,
      categorySlug: input.categorySlug,
      brandId: input.brandId,
      storeProductId: input.storeProductId,
      claimsAuthenticBrand: true,
      copy: {
        lo: { title: input.titleLo },
        en: { title: input.titleEn },
      },
    });
    const variantId = await catalog.createVariant({
      productId,
      storeId: input.storeId,
      sku: input.sku,
      hasShelfLife: false,
    });
    await catalog.setStatus('products', productId, 'active');
    await catalog.setStatus('product_variants', variantId, 'active');
    const proposed = await pricing.proposePrice({
      variantId,
      costLak: input.costLak,
      sellingPriceLak: input.sellingPriceLak,
      compareAtPriceLak: input.compareAtPriceLak,
      makerIdentityId: maker.identityId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: owner.identityId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });

    await inventory.setSafetyBuffer(input.storeId, variantId, 2);
    const lotId = await inventory.createLot({
      storeId: input.storeId,
      variantId,
      locationId: input.locationId,
      lotCode: `LOT-${input.sku}`,
      productionDate: '2026-01-01',
      expiryDate: '2027-12-01',
      categorySlug: input.categorySlug,
    });
    const balanceId = await inventory.ensureBalance({
      storeId: input.storeId,
      locationId: input.locationId,
      variantId,
      lotId,
    });
    await inventory.receive({
      balanceId,
      quantity: input.receiveQty,
      correlationId: crypto.randomUUID(),
      actorIdentityId: maker.identityId,
      reason: 'local_seed_receive',
    });
    return variantId;
  }

  await sellable({
    storeId: storeFresh,
    locationId: locationFresh,
    categorySlug: 'food',
    brandId: brandWater,
    storeProductId: 'drinking-water',
    sku: 'WATER-12',
    titleLo: 'ນ້ຳດື່ມ ແພັກ 12',
    titleEn: 'Drinking Water 12-pack',
    costLak: 30000,
    sellingPriceLak: 45000,
    compareAtPriceLak: 52000,
    receiveQty: 24,
  });
  await sellable({
    storeId: storeHome,
    locationId: locationHome,
    categorySlug: 'general',
    brandId: brandHome,
    storeProductId: 'ceramic-mug',
    sku: 'MUG-01',
    titleLo: 'ຈອກເຊລາມິກ',
    titleEn: 'Ceramic Mug',
    costLak: 15000,
    sellingPriceLak: 35000,
    receiveQty: 40,
  });
  await sellable({
    storeId: storeFresh,
    locationId: locationFresh,
    categorySlug: 'cosmetics',
    brandId: brandWater,
    storeProductId: 'aloe-gel',
    sku: 'ALOE-100',
    titleLo: 'ເຈລໂอลໂລ',
    titleEn: 'Aloe Gel 100ml',
    costLak: 20000,
    sellingPriceLak: 42000,
    receiveQty: 18,
  });
}
