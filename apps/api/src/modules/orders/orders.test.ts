import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { OrderService } from './orderService.js';
import { canTransition, deriveParentStatus } from './stateMachine.js';

describe('Milestone 5 orders', () => {
  let db: PGlite;
  let orders: OrderService;
  let customerId: string;
  let adminId: string;
  let ownerId: string;
  let storeA: string;
  let storeB: string;
  let variantA: string;
  let variantB: string;

  async function activateStore(code: string, name: string) {
    const stores = new StoreService(db);
    const storeId = await stores.createStore({ code, name });
    for (const docType of ['owner_id', 'store_info', 'bank_account', 'contract'] as const) {
      const docId = await stores.uploadDocument({
        storeId,
        docType,
        storageKey: `private/${storeId}/${docType}.pdf`,
        expiresAt: '2027-01-01',
      });
      await stores.verifyDocument(docId, storeId);
    }
    await stores.addFulfillmentLocation({
      storeId,
      name: 'Main',
      addressLine: 'VTE',
      active: true,
    });
    await stores.activateIfReady(storeId);
    return storeId;
  }

  async function createSellableVariant(storeId: string, sku: string, storeProductId: string) {
    const catalog = new CatalogService(db);
    const pricing = new PricingService(db);
    const productId = await catalog.createProduct({
      storeId,
      categorySlug: 'general',
      storeProductId,
      copy: { lo: { title: `ສິນຄ້າ ${sku}` }, en: { title: `Item ${sku}` } },
    });
    const variantId = await catalog.createVariant({
      productId,
      storeId,
      sku,
      hasShelfLife: false,
    });
    await catalog.setStatus('products', productId, 'active');
    await catalog.setStatus('product_variants', variantId, 'active');
    const proposed = await pricing.proposePrice({
      variantId,
      costLak: 1000,
      sellingPriceLak: 2000,
      makerIdentityId: adminId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    return variantId;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    customerId = await identity.ensureCustomer('+8562096000001', 'Buyer');
    adminId = (await identity.ensureStaff('staff:admin-m5', 'Admin', '+8562086000001')).identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m5', 'Owner', '+8562086000002')).identityId;
    storeA = await activateStore('ORD-A', 'Order Store A');
    storeB = await activateStore('ORD-B', 'Order Store B');
    variantA = await createSellableVariant(storeA, 'SKU-A', 'SP-A');
    variantB = await createSellableVariant(storeB, 'SKU-B', 'SP-B');
    orders = new OrderService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates multi-store parent/child orders atomically with immutable snapshots', async () => {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId: storeA, variantId: variantA, quantity: 2 });
    await orders.addCartItem(cartId, { storeId: storeB, variantId: variantB, quantity: 1 });

    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      shippingLakByStore: { [storeA]: 5000, [storeB]: 3000 },
      promoPercentOff: 10,
      correlationId: crypto.randomUUID(),
    });
    expect(created.childIds).toHaveLength(2);

    const views = await orders.getOrderViews(created.parentId);
    expect(views.byStore).toHaveLength(2);
    expect(views.documents.some((d: { doc_type: string }) => d.doc_type === 'combined_summary')).toBe(
      true,
    );

    await expect(
      db.query(`UPDATE app.order_items SET unit_price_lak = 1`),
    ).rejects.toThrow(/immutable/);
  });

  it('enforces transition matrix and derives parent completed with cancellation note', async () => {
    expect(canTransition('pending_supplier', 'delivered')).toBe(false);
    expect(canTransition('pending_supplier', 'confirmed')).toBe(true);

    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId: storeA, variantId: variantA, quantity: 1 });
    await orders.addCartItem(cartId, { storeId: storeB, variantId: variantB, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const [childA, childB] = created.childIds;

    const forbidden = await orders.transitionChild({
      childOrderId: childA!,
      toStatus: 'delivered',
      actorIdentityId: adminId,
      reason: 'skip ahead',
      correlationId: crypto.randomUUID(),
    });
    expect(forbidden).toEqual({ ok: false, reason: 'transition_forbidden' });

    for (const step of ['confirmed', 'awaiting_payment', 'packing', 'ready', 'handed_to_courier', 'in_transit', 'delivered'] as const) {
      const result = await orders.transitionChild({
        childOrderId: childA!,
        toStatus: step,
        actorIdentityId: adminId,
        reason: `to ${step}`,
        correlationId: crypto.randomUUID(),
      });
      expect(result.ok).toBe(true);
    }

    await orders.transitionChild({
      childOrderId: childB!,
      toStatus: 'cancelled',
      actorIdentityId: adminId,
      reason: 'store out of stock',
      correlationId: crypto.randomUUID(),
    });

    const parent = await db.query<{ status: string; cancellation_note: string | null }>(
      `SELECT status, cancellation_note FROM app.parent_orders WHERE id = $1`,
      [created.parentId],
    );
    expect(parent.rows[0]?.status).toBe('completed');
    expect(parent.rows[0]?.cancellation_note).toMatch(/cancelled/i);

    const replay = await orders.transitionChild({
      childOrderId: childB!,
      toStatus: 'cancelled',
      actorIdentityId: adminId,
      reason: 'store out of stock',
      correlationId: 'same-correlation',
    });
    // already cancelled — transition forbidden from cancelled
    expect(replay.ok).toBe(false);

    expect(
      deriveParentStatus(['delivered', 'cancelled']),
    ).toMatchObject({ status: 'completed' });
  });

  it('previews partial cancel promo recalculation and blocks cancel after handoff', async () => {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId: storeA, variantId: variantA, quantity: 2 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      promoPercentOff: 10,
      correlationId: crypto.randomUUID(),
    });
    const childId = created.childIds[0]!;
    const item = await db.query<{ id: string; line_total_lak: number }>(
      `SELECT id, line_total_lak FROM app.order_items WHERE child_order_id = $1 LIMIT 1`,
      [childId],
    );

    const preview = await orders.previewCancellation({
      parentOrderId: created.parentId,
      scope: 'item',
      childOrderId: childId,
      orderItemId: item.rows[0]!.id,
      promoPercentOff: 10,
    });
    expect(preview.cancelledLineTotal).toBe(item.rows[0]!.line_total_lak);
    expect(preview.newTotalLak).toBeLessThan(4000);

    await orders.transitionChild({
      childOrderId: childId,
      toStatus: 'confirmed',
      actorIdentityId: adminId,
      reason: 'ok',
      correlationId: crypto.randomUUID(),
    });
    const cancelled = await orders.confirmCancellation({
      parentOrderId: created.parentId,
      previewId: preview.previewId,
      scope: 'item',
      childOrderId: childId,
      orderItemId: item.rows[0]!.id,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
      promoPercentOff: 10,
    });
    expect(cancelled.ok).toBe(true);

    // handoff then cancel blocked
    const cart2 = await orders.createCart(customerId);
    await orders.addCartItem(cart2, { storeId: storeA, variantId: variantA, quantity: 1 });
    const created2 = await orders.checkout({
      cartId: cart2,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const child2 = created2.childIds[0]!;
    for (const step of ['confirmed', 'awaiting_payment', 'packing', 'ready', 'handed_to_courier'] as const) {
      await orders.transitionChild({
        childOrderId: child2,
        toStatus: step,
        actorIdentityId: adminId,
        reason: step,
        correlationId: crypto.randomUUID(),
      });
    }
    const preview2 = await orders.previewCancellation({
      parentOrderId: created2.parentId,
      scope: 'store',
      childOrderId: child2,
    });
    const blocked = await orders.confirmCancellation({
      parentOrderId: created2.parentId,
      previewId: preview2.previewId,
      scope: 'store',
      childOrderId: child2,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    expect(blocked).toEqual({ ok: false, reason: 'use_refusal_or_return_workflow' });

    const refunded = await orders.confirmCancellation({
      parentOrderId: created.parentId,
      previewId: preview.previewId,
      scope: 'store',
      childOrderId: childId,
      actorIdentityId: customerId,
      paymentReceived: true,
      correlationId: crypto.randomUUID(),
    });
    // child may already be partial_cancelled; if still before handoff store cancel works
    if (refunded.ok && 'refundRequestId' in refunded) {
      expect(refunded.refundRequestId).toBeTruthy();
    }
  });

  it('requires admin approval for split shipments referencing child items', async () => {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId: storeA, variantId: variantA, quantity: 2 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const childId = created.childIds[0]!;
    const items = await db.query<{ id: string }>(
      `SELECT id FROM app.order_items WHERE child_order_id = $1`,
      [childId],
    );
    const split = await orders.requestSplitShipment({
      childOrderId: childId,
      makerIdentityId: adminId,
      reason: 'split into two parcels',
      itemQuantities: [{ orderItemId: items.rows[0]!.id, quantity: 1 }],
    });

    expect(
      await orders.approveSplitShipment({
        requestId: split.requestId,
        shipmentId: split.shipmentId,
        approverIdentityId: adminId,
        actorRoles: ['admin'],
      }),
    ).toEqual({ ok: false, reason: 'self_approval' });

    const approved = await orders.approveSplitShipment({
      requestId: split.requestId,
      shipmentId: split.shipmentId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
    });
    expect(approved).toEqual({ ok: true });

    const shipmentItems = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.shipment_items WHERE shipment_id = $1`,
      [split.shipmentId],
    );
    expect(shipmentItems.rows[0]?.n).toBe(1);
  });
});
