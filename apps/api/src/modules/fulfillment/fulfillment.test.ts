import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { ContractService } from '../stores/contractService.js';
import { PayoutService } from '../stores/payoutService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { OrderService } from '../orders/orderService.js';
import { PaymentService } from '../payments/paymentService.js';
import {
  ApiCourierAdapter,
  DeliveryService,
  ManualCourierAdapter,
} from './deliveryService.js';
import { ReturnService } from './returnService.js';
import { RecallService } from './recallService.js';
import { SettlementService } from './settlementService.js';

describe('Milestone 7 fulfillment', () => {
  let db: PGlite;
  let delivery: DeliveryService;
  let returns: ReturnService;
  let recalls: RecallService;
  let settlements: SettlementService;
  let orders: OrderService;
  let payments: PaymentService;
  let customerId: string;
  let financeId: string;
  let ownerId: string;
  let storeId: string;
  let productId: string;
  let variantId: string;

  async function activateStore(code: string) {
    const stores = new StoreService(db);
    const id = await stores.createStore({ code, name: code });
    for (const docType of ['owner_id', 'store_info', 'bank_account', 'contract'] as const) {
      const docId = await stores.uploadDocument({
        storeId: id,
        docType,
        storageKey: `private/${id}/${docType}.pdf`,
        expiresAt: '2027-01-01',
      });
      await stores.verifyDocument(docId, id);
    }
    await stores.addFulfillmentLocation({
      storeId: id,
      name: 'Main',
      addressLine: 'VTE',
      active: true,
    });
    await stores.activateIfReady(id);
    return id;
  }

  async function sellable() {
    const catalog = new CatalogService(db);
    const pricing = new PricingService(db);
    const pid = await catalog.createProduct({
      storeId,
      categorySlug: 'general',
      storeProductId: 'SP-FUL-1',
      copy: { lo: { title: 'ສິນຄ້າ' }, en: { title: 'Item' } },
    });
    const vid = await catalog.createVariant({
      productId: pid,
      storeId,
      sku: 'FUL-SKU-1',
      hasShelfLife: false,
    });
    await catalog.setStatus('products', pid, 'active');
    await catalog.setStatus('product_variants', vid, 'active');
    const proposed = await pricing.proposePrice({
      variantId: vid,
      costLak: 1000,
      sellingPriceLak: 100_000,
      makerIdentityId: financeId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    return { productId: pid, variantId: vid };
  }

  async function deliveredPaidChild() {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId, variantId, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const childId = created.childIds[0]!;
    await orders.transitionChild({
      childOrderId: childId,
      toStatus: 'confirmed',
      actorIdentityId: ownerId,
      reason: 'ok',
      correlationId: crypto.randomUUID(),
    });
    const qr = await payments.createQrPaymentRequest({
      parentOrderId: created.parentId,
      childOrderIds: [childId],
      actorIdentityId: customerId,
      now: new Date('2026-09-03T08:00:00.000Z'),
    });
    const evidence = await payments.submitEvidence({
      paymentRequestId: qr.paymentRequestId,
      amountReportedLak: qr.amountLak,
      evidenceStorageKey: 'ev/1.jpg',
      idempotencyKey: `ev-${childId}`,
    });
    await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: evidence.attemptId,
      bankRef: `BR-${childId}`,
      amountLak: qr.amountLak,
      channel: 'manual',
      actorIdentityId: financeId,
      idempotencyKey: `cf-${childId}`,
      now: new Date('2026-09-03T09:00:00.000Z'),
    });
    await db.query(
      `UPDATE app.child_orders
       SET status = 'delivered', payment_received = true, updated_at = timezone('utc', now())
       WHERE id = $1`,
      [childId],
    );
    const contracts = new ContractService(db);
    await contracts.snapshotForChildOrder({
      childOrderId: childId,
      storeId,
      orderCreatedAt: new Date().toISOString(),
    });
    return { childId, parentId: created.parentId, paymentRequestId: qr.paymentRequestId };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    customerId = await identity.ensureCustomer('+8562097100001', 'Fulfill Customer');
    financeId = (await identity.ensureStaff('staff:fin-m7', 'Finance', '+8562087100001'))
      .identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m7', 'Owner', '+8562087100002')).identityId;
    storeId = await activateStore('FUL-A');
    const sell = await sellable();
    productId = sell.productId;
    variantId = sell.variantId;
    orders = new OrderService(db);
    payments = new PaymentService(db);
    delivery = new DeliveryService(db);
    returns = new ReturnService(db);
    recalls = new RecallService(db);
    settlements = new SettlementService(db);

    const contracts = new ContractService(db);
    await contracts.createVersion({
      storeId,
      terms: {
        revenueModel: 'commission',
        commissionBps: 1000,
        settlementCadence: 'weekly',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
      createdBy: ownerId,
    });

    const payouts = new PayoutService(db);
    const versionId = await payouts.createPendingVersion({
      storeId,
      bankName: 'BCEL',
      accountNumberLast4: '1234',
      accountHolder: 'Store A',
    });
    const reqId = await payouts.requestChange({
      storeId,
      requestedVersionId: versionId,
      makerIdentityId: financeId,
    });
    // Approve far enough in the past that the 48h payout hold has expired.
    await payouts.approveChange({
      requestId: reqId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: true,
      now: Date.now() - 49 * 60 * 60_000,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('supports manual/API delivery adapters, packing SLA, POD, and claims', async () => {
    const { childId } = await deliveredPaidChild();
    const confirmedAt = new Date('2026-09-03T08:00:00.000Z');
    await delivery.schedulePackingDeadline(childId, confirmedAt);
    const late = await delivery.evaluateLatePacking(
      childId,
      new Date('2026-09-04T10:00:00.000Z'),
    );
    expect(late.late).toBe(true);
    await delivery.markPacked(childId, new Date('2026-09-04T11:00:00.000Z'));

    const courier = await delivery.createCourier({
      code: 'LAO-POST',
      name: 'Lao Post',
      compensationRules: { maxLak: 1_000_000 },
    });
    const manual = await delivery.createDelivery({
      childOrderId: childId,
      courierId: courier.courierId,
      channel: 'manual',
      adapter: new ManualCourierAdapter(),
      packagePhotoKey: 'pkg/1.jpg',
      actorIdentityId: ownerId,
    });
    expect(manual.trackingNumber.startsWith('MAN-')).toBe(true);
    expect(manual.podMethods).toContain('otp');

    await delivery.handoff({
      deliveryId: manual.deliveryId,
      handoffAt: new Date('2026-09-05T09:00:00.000Z'),
      actorIdentityId: ownerId,
    });
    await delivery.recordPod({
      deliveryId: manual.deliveryId,
      podMethod: 'signature',
      evidenceKey: 'pod/sig.png',
      deliveredAt: new Date('2026-09-06T12:00:00.000Z'),
    });

    const claim = await delivery.openClaim({
      deliveryId: manual.deliveryId,
      claimType: 'damaged',
      notes: 'box crushed',
    });
    expect(claim.liabilityParty).toBe('courier');

    const apiCourier = await delivery.createCourier({ code: 'API-CO', name: 'API Co' });
    const { childId: child2 } = await deliveredPaidChild();
    const apiShip = await delivery.createDelivery({
      childOrderId: child2,
      courierId: apiCourier.courierId,
      channel: 'api',
      adapter: new ApiCourierAdapter(),
      actorIdentityId: ownerId,
    });
    expect(apiShip.trackingNumber.startsWith('API-')).toBe(true);
  });

  it('enforces return eligibility, refund approval SLA, and ledger-only refund pay', async () => {
    const { childId, paymentRequestId } = await deliveredPaidChild();
    await expect(
      returns.requestReturn({
        childOrderId: childId,
        reason: 'change_of_mind',
        deliveredAt: new Date('2026-09-01T00:00:00.000Z'),
        createdBy: customerId,
      }),
    ).rejects.toThrow('change_of_mind_not_allowed');

    const ret = await returns.requestReturn({
      childOrderId: childId,
      reason: 'defective',
      deliveredAt: new Date('2026-09-01T00:00:00.000Z'),
      requestedAt: new Date('2026-09-03T00:00:00.000Z'),
      evidenceKeys: ['ret/1.jpg'],
      createdBy: customerId,
    });
    expect(ret.shippingLiability).toBe('store');
    await returns.appendCommunication(ret.returnRequestId, {
      from: 'support',
      text: 'received evidence',
    });

    const refund = await returns.createRefundRequest({
      childOrderId: childId,
      amountLak: 50_000,
      reason: 'defective partial',
      makerIdentityId: financeId,
    });
    await expect(
      returns.approveRefund({
        approvalId: refund.approvalId,
        approverIdentityId: financeId,
      }),
    ).rejects.toThrow('self_approval_denied');

    const approved = await returns.approveRefund({
      approvalId: refund.approvalId,
      approverIdentityId: ownerId,
      approvedAt: new Date('2026-09-04T10:00:00.000Z'),
    });
    expect(approved.slaDueAt.startsWith('2026-09-15')).toBe(true);

    const paid = await returns.payRefundViaLedger({
      approvalId: refund.approvalId,
      paymentRequestId,
      paidAt: new Date('2026-09-10T10:00:00.000Z'),
    });
    expect(paid.withinSla).toBe(true);
    const ledger = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance.payment_refunds WHERE id = $1`,
      [paid.paymentRefundId],
    );
    expect(ledger.rows[0]?.n).toBe(1);
  });

  it('starts recall, blocks product, and tracks affected orders to completion', async () => {
    const a = await deliveredPaidChild();
    const b = await deliveredPaidChild();
    const started = await recalls.startRecall({
      productId,
      reason: 'contamination',
      createdBy: ownerId,
    });
    expect(started.affectedCount).toBeGreaterThanOrEqual(2);
    expect(started.storeBearsCost).toBe(true);
    const product = await db.query<{ status: string }>(
      `SELECT status FROM app.products WHERE id = $1`,
      [productId],
    );
    expect(product.rows[0]?.status).toBe('archived');

    const affected = await db.query<{ child_order_id: string }>(
      `SELECT child_order_id FROM app.recall_affected_orders WHERE recall_id = $1`,
      [started.recallId],
    );
    for (const row of affected.rows) {
      await recalls.recordContact({
        recallId: started.recallId,
        childOrderId: row.child_order_id,
        contactStatus: 'contacted',
        resolution: 'refund',
      });
    }
    const done = await recalls.isComplete(started.recallId);
    expect(done.complete).toBe(true);
    // keep references used
    expect(a.childId).toBeTruthy();
    expect(b.childId).toBeTruthy();
  });

  it('settles only delivered+paid, maker-checker, dispute holds, negative carry', async () => {
    // restore product for new orders
    await db.query(`UPDATE app.products SET status = 'active' WHERE id = $1`, [productId]);
    await db.query(
      `UPDATE app.product_variants SET status = 'active', archived_at = null WHERE product_id = $1`,
      [productId],
    );
    const paid = await deliveredPaidChild();

    // unpaid / not delivered should not settle
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId, variantId, quantity: 1 });
    const pending = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });

    const batch = await settlements.createBatch({
      storeId,
      makerIdentityId: financeId,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-08T00:00:00.000Z'),
      cadence: 'weekly',
    });
    expect(batch.lineCount).toBeGreaterThanOrEqual(1);
    expect(batch.payoutAccountVersionId).toBeTruthy();

    const lines = await db.query<{ child_order_id: string }>(
      `SELECT child_order_id FROM finance.settlement_lines WHERE batch_id = $1`,
      [batch.batchId],
    );
    expect(lines.rows.some((r) => r.child_order_id === pending.childIds[0])).toBe(false);
    expect(lines.rows.some((r) => r.child_order_id === paid.childId)).toBe(true);

    await settlements.holdLine({
      batchId: batch.batchId,
      childOrderId: paid.childId,
      reason: 'return_pending_check',
    });
    await db.query(
      `UPDATE finance.settlement_lines SET held = false, hold_reason = null
       WHERE batch_id = $1 AND child_order_id = $2`,
      [batch.batchId, paid.childId],
    );

    await settlements.submitForApproval(batch.batchId);
    await expect(
      settlements.approveBatch({ batchId: batch.batchId, approverIdentityId: financeId }),
    ).rejects.toThrow('self_approval_denied');
    await settlements.approveBatch({
      batchId: batch.batchId,
      approverIdentityId: ownerId,
    });

    const dispute = await settlements.openDispute({
      batchId: batch.batchId,
      childOrderId: paid.childId,
      reason: 'fee mismatch',
      now: new Date('2026-09-05T00:00:00.000Z'),
    });
    expect(dispute.disputeId).toBeTruthy();
    const held = await db.query<{ held: boolean; disputed: boolean; status: string }>(
      `SELECT l.held, l.disputed, b.status
       FROM finance.settlement_lines l
       JOIN finance.settlement_batches b ON b.id = l.batch_id
       WHERE l.batch_id = $1 AND l.child_order_id = $2`,
      [batch.batchId, paid.childId],
    );
    expect(held.rows[0]?.held).toBe(true);
    expect(held.rows[0]?.disputed).toBe(true);
    expect(held.rows[0]?.status).toBe('partially_disputed');

    const neg = await settlements.recordNegativeCarryForward({
      storeId,
      amountLak: -25_000,
      sourceBatchId: batch.batchId,
      collect: true,
    });
    expect(neg.collectionRequestId).toBeTruthy();
  });
});
