import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { InventoryService } from './inventoryService.js';
import { ReservationService } from './reservationService.js';
import { QR_RESERVATION_GRACE_MS, availableQty } from './rules.js';

describe('Milestone 4 inventory', () => {
  let db: PGlite;
  let inventory: InventoryService;
  let reservations: ReservationService;
  let storeId: string;
  let locationId: string;
  let variantId: string;
  let lotId: string;
  let balanceId: string;
  let makerId: string;
  let ownerId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    makerId = (await identity.ensureStaff('staff:ops-m4', 'Ops', '+8562085000001')).identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m4', 'Owner', '+8562085000002')).identityId;

    const stores = new StoreService(db);
    storeId = await stores.createStore({ code: 'INV01', name: 'Inventory Store' });
    locationId = await stores.addFulfillmentLocation({
      storeId,
      name: 'Main WH',
      addressLine: 'Vientiane',
      active: true,
    });

    const catalog = new CatalogService(db);
    const productId = await catalog.createProduct({
      storeId,
      categorySlug: 'food',
      storeProductId: 'INV-WATER',
      hasShelfLife: true,
      copy: {
        lo: { title: 'ນ້ຳ', warnings: 'ເກັບเย็น' },
        en: { title: 'Water', warnings: 'Keep cool' },
      },
    });
    variantId = await catalog.createVariant({
      productId,
      storeId,
      sku: 'INV-WATER-1L',
      hasShelfLife: true,
      productionDate: '2026-01-01',
      expiryDate: '2027-06-01',
      ingredients: 'water',
      warnings: 'Keep cool',
    });

    inventory = new InventoryService(db);
    reservations = new ReservationService(db, inventory);
    await inventory.setSafetyBuffer(storeId, variantId, 2);
    lotId = await inventory.createLot({
      storeId,
      variantId,
      locationId,
      lotCode: 'LOT-A',
      productionDate: '2026-01-01',
      expiryDate: '2027-06-01',
      categorySlug: 'food',
    });
    balanceId = await inventory.ensureBalance({
      storeId,
      locationId,
      variantId,
      lotId,
    });
    await inventory.receive({
      balanceId,
      quantity: 10,
      correlationId: crypto.randomUUID(),
      actorIdentityId: makerId,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('computes available with safety buffer and rejects negative stock', async () => {
    const bal = await inventory.getBalance(balanceId);
    expect(bal.on_hand).toBe(10);
    expect(bal.safety_buffer).toBe(2);
    expect(bal.available).toBe(availableQty(10, 0, 2));

    const denied = await inventory.adjust({
      balanceId,
      delta: -20,
      reason: 'cycle count correction attempt',
      makerIdentityId: makerId,
      approverIdentityId: ownerId,
      actorRoles: ['operations'],
      correlationId: crypto.randomUUID(),
    });
    expect(denied).toEqual({ ok: false, reason: 'insufficient_stock' });

    const alerts = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM private.inventory_stockout_alerts WHERE variant_id = $1`,
      [variantId],
    );
    expect(alerts.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('prevents oversell via double reservation against available qty', async () => {
    const first = await reservations.reserve({
      balanceId,
      quantity: 8,
      reservationType: 'cod',
      idempotencyKey: 'res-1',
      correlationId: crypto.randomUUID(),
    });
    expect(first.ok).toBe(true);

    const second = await reservations.reserve({
      balanceId,
      quantity: 1,
      reservationType: 'cod',
      idempotencyKey: 'res-2',
      correlationId: crypto.randomUUID(),
    });
    expect(second).toEqual({ ok: false, reason: 'insufficient_available' });

    const replay = await reservations.reserve({
      balanceId,
      quantity: 8,
      reservationType: 'cod',
      idempotencyKey: 'res-1',
      correlationId: crypto.randomUUID(),
    });
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
  });

  it('expires QR reservations after payment deadline + 30 minutes and releases idempotently', async () => {
    const active = await db.query<{ id: string }>(
      `SELECT id FROM private.inventory_reservations WHERE status = 'active'`,
    );
    for (const row of active.rows) {
      await reservations.release({
        reservationId: row.id,
        correlationId: crypto.randomUUID(),
      });
    }

    const paymentDeadline = Date.now();
    const reserved = await reservations.reserve({
      balanceId,
      quantity: 3,
      reservationType: 'qr',
      idempotencyKey: 'res-qr-1',
      correlationId: crypto.randomUUID(),
      paymentDeadlineAt: paymentDeadline,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;

    const expired = await reservations.expireDue(paymentDeadline + QR_RESERVATION_GRACE_MS + 1);
    expect(expired[0]?.status).toBe('expired');

    const again = await reservations.release({
      reservationId: reserved.reservationId,
      correlationId: crypto.randomUUID(),
    });
    expect(again).toMatchObject({ ok: true, idempotentReplay: true });
  });

  it('blocks expired/recall lots and can link near-expiry discount requests', async () => {
    const shortLot = await inventory.createLot({
      storeId,
      variantId,
      locationId,
      lotCode: 'LOT-SHORT',
      productionDate: '2026-08-01',
      expiryDate: '2026-09-20',
      categorySlug: 'food',
    });
    const decision = await inventory.evaluateLotForAllocation(
      shortLot,
      'food',
      Date.parse('2026-09-03T00:00:00.000Z'),
    );
    expect(decision.ok).toBe(false);

    const pricing = new PricingService(db);
    const discountId = await pricing.requestNearExpiryDiscount({
      variantId,
      proposedSellingPriceLak: 1000,
      reason: 'near minimum shelf life',
      makerIdentityId: makerId,
    });
    await inventory.linkExpiryDiscount(shortLot, discountId);

    await db.query(`UPDATE private.inventory_lots SET status = 'recall' WHERE id = $1`, [lotId]);
    const recall = await inventory.evaluateLotForAllocation(lotId, 'food');
    expect(recall).toEqual({ ok: false, reason: 'lot_recall' });
    await db.query(`UPDATE private.inventory_lots SET status = 'available' WHERE id = $1`, [lotId]);
  });

  it('reconciles ledger to zero difference for fixture transactions', async () => {
    const result = await inventory.reconcileLedger(balanceId);
    expect(result.difference).toBe(0);
    expect(result.balanceOnHand).toBe(result.ledgerOnHand);
    expect(result.balanceReserved).toBe(result.ledgerReserved);
  });

  it('supports stock import preview reconciliation report', async () => {
    const preview = await inventory.previewStockImport({
      storeId,
      idempotencyKey: 'stock-imp-1',
      rows: [{ variantId, lotId, onHand: 12 }],
    });
    expect(preview.report).toMatchObject({ differenceTotal: expect.any(Number) });
    const replay = await inventory.previewStockImport({
      storeId,
      idempotencyKey: 'stock-imp-1',
      rows: [{ variantId, lotId, onHand: 12 }],
    });
    expect(replay.replay).toBe(true);

    const before = await inventory.getBalance(balanceId);
    const commit = await inventory.commitStockImport({ batchId: preview.batchId });
    expect(commit).toEqual({ ok: true, replay: false });
    const after = await inventory.getBalance(balanceId);
    expect(after.on_hand).toBe(before.on_hand + (12 - before.on_hand));
    const commitReplay = await inventory.commitStockImport({ batchId: preview.batchId });
    expect(commitReplay).toEqual({ ok: true, replay: true });
    const listed = await inventory.listStockImportBatches(10);
    expect(listed.some((b) => b.batchId === preview.batchId && b.status === 'committed')).toBe(
      true,
    );
  });
});
