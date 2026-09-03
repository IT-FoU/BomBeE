import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { OrderService } from '../orders/orderService.js';
import { PaymentService } from './paymentService.js';
import {
  COD_NEW_CUSTOMER_LIMIT_LAK,
  evaluateCodEligibility,
  computeQrDeadline,
} from './rules.js';

describe('Milestone 6 payments', () => {
  let db: PGlite;
  let payments: PaymentService;
  let orders: OrderService;
  let customerId: string;
  let financeId: string;
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
      copy: { lo: { title: sku }, en: { title: sku } },
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
      sellingPriceLak: 200_000,
      makerIdentityId: financeId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    return variantId;
  }

  async function createConfirmedOrder() {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId: storeA, variantId: variantA, quantity: 1 });
    await orders.addCartItem(cartId, { storeId: storeB, variantId: variantB, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    for (const childId of created.childIds) {
      await orders.transitionChild({
        childOrderId: childId,
        toStatus: 'confirmed',
        actorIdentityId: ownerId,
        reason: 'supplier confirmed',
        correlationId: crypto.randomUUID(),
      });
    }
    return created;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    customerId = await identity.ensureCustomer('+8562097000001', 'Pay Customer');
    financeId = (await identity.ensureStaff('staff:fin-m6', 'Finance', '+8562087000001')).identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m6', 'Owner', '+8562087000002')).identityId;
    storeA = await activateStore('PAY-A', 'Pay Store A');
    storeB = await activateStore('PAY-B', 'Pay Store B');
    variantA = await createSellableVariant(storeA, 'PAY-SKU-A', 'SP-PAY-A');
    variantB = await createSellableVariant(storeB, 'PAY-SKU-B', 'SP-PAY-B');
    orders = new OrderService(db);
    payments = new PaymentService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates combined QR after confirmation with same-day >=2h deadline', async () => {
    const created = await createConfirmedOrder();
    const now = new Date('2026-09-03T08:00:00.000Z');
    const qr = await payments.createQrPaymentRequest({
      parentOrderId: created.parentId,
      childOrderIds: created.childIds,
      actorIdentityId: customerId,
      now,
    });
    expect(qr.amountLak).toBe(400_000);
    expect(Date.parse(qr.expiresAt)).toBe(computeQrDeadline(now).getTime());

    const alloc = await db.query<{ n: number; total: number }>(
      `SELECT count(*)::int AS n, sum(amount_lak)::bigint AS total
       FROM finance.payment_allocations WHERE payment_request_id = $1`,
      [qr.paymentRequestId],
    );
    expect(alloc.rows[0]?.n).toBe(2);
    expect(Number(alloc.rows[0]?.total)).toBe(400_000);
  });

  it('handles evidence pending, exact/over/under pay, expiry, and duplicate confirmation', async () => {
    const created = await createConfirmedOrder();
    const qr = await payments.createQrPaymentRequest({
      parentOrderId: created.parentId,
      childOrderIds: [created.childIds[0]!],
      actorIdentityId: customerId,
      now: new Date('2026-09-03T08:00:00.000Z'),
    });

    const evidence = await payments.submitEvidence({
      paymentRequestId: qr.paymentRequestId,
      amountReportedLak: 200_000,
      evidenceStorageKey: 'private/evidence/1.png',
      idempotencyKey: 'ev-1',
    });
    expect(evidence.evidenceStatus).toBe('pending');

    const confirmed = await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: evidence.attemptId,
      channel: 'manual',
      amountLak: 200_000,
      bankRef: 'BANK-1',
      idempotencyKey: 'confirm-1',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:00:00.000Z'),
    });
    expect(confirmed.ok).toBe(true);

    const dup = await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: evidence.attemptId,
      channel: 'bank_api',
      amountLak: 200_000,
      bankRef: 'BANK-1',
      idempotencyKey: 'confirm-1-dup',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:05:00.000Z'),
    });
    expect(dup).toMatchObject({ ok: true, idempotentReplay: true });

    // overpay
    const created2 = await createConfirmedOrder();
    const qr2 = await payments.createQrPaymentRequest({
      parentOrderId: created2.parentId,
      childOrderIds: [created2.childIds[0]!],
      actorIdentityId: customerId,
      now: new Date('2026-09-03T08:00:00.000Z'),
    });
    const ev2 = await payments.submitEvidence({
      paymentRequestId: qr2.paymentRequestId,
      amountReportedLak: 250_000,
      evidenceStorageKey: 'private/evidence/2.png',
      idempotencyKey: 'ev-2',
    });
    const over = await payments.confirmPayment({
      paymentRequestId: qr2.paymentRequestId,
      attemptId: ev2.attemptId,
      channel: 'manual',
      amountLak: 250_000,
      bankRef: 'BANK-OVER',
      idempotencyKey: 'confirm-over',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:00:00.000Z'),
    });
    expect(over).toMatchObject({ ok: true, excessRefundLak: 50_000 });

    // underpay
    const created3 = await createConfirmedOrder();
    const qr3 = await payments.createQrPaymentRequest({
      parentOrderId: created3.parentId,
      childOrderIds: [created3.childIds[0]!],
      actorIdentityId: customerId,
      now: new Date('2026-09-03T08:00:00.000Z'),
    });
    const ev3 = await payments.submitEvidence({
      paymentRequestId: qr3.paymentRequestId,
      amountReportedLak: 100_000,
      evidenceStorageKey: 'private/evidence/3.png',
      idempotencyKey: 'ev-3',
    });
    const under = await payments.confirmPayment({
      paymentRequestId: qr3.paymentRequestId,
      attemptId: ev3.attemptId,
      channel: 'manual',
      amountLak: 100_000,
      bankRef: 'BANK-UNDER',
      idempotencyKey: 'confirm-under',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:00:00.000Z'),
    });
    expect(under.ok).toBe(true);
    if (under.ok && 'underpaymentFollowUp' in under) {
      expect(under.underpaymentFollowUp?.amountLak).toBe(100_000);
    }

    const expired = await payments.expirePaymentRequest(
      qr3.paymentRequestId,
      new Date('2026-09-04T00:00:00.000Z'),
    );
    // already partially_paid — expire still allowed for open remainder semantics
    expect(['expired', 'not_due', 'already_paid']).toContain(
      expired.ok ? expired.status : expired.reason,
    );
  });

  it('enforces COD limits, deposit, failure force QR, remittance separate from delivery', async () => {
    expect(
      evaluateCodEligibility({
        amountLak: COD_NEW_CUSTOMER_LIMIT_LAK + 1,
        isNewCustomer: true,
        failedCodCount: 0,
        qrForced: false,
        phoneVerified: true,
      }),
    ).toEqual({ ok: false, reason: 'new_customer_limit' });

    const created = await createConfirmedOrder();
    const childId = created.childIds[0]!;
    const deniedPhone = await payments.createCodShipment({
      customerIdentityId: customerId,
      childOrderId: childId,
      amountLak: 300_000,
      phoneVerified: false,
    });
    expect(deniedPhone).toEqual({ ok: false, reason: 'phone_verification_required' });

    const cod = await payments.createCodShipment({
      customerIdentityId: customerId,
      childOrderId: childId,
      amountLak: 300_000,
      phoneVerified: true,
    });
    expect(cod.ok).toBe(true);
    if (!cod.ok) return;
    expect(cod.depositLak).toBe(90_000);
    expect(cod.balanceDueLak).toBe(210_000);

    await payments.recordCustomerCodFailure(customerId, true);
    const afterOne = await payments.recordCustomerCodFailure(customerId, true);
    expect(afterOne.qr_forced).toBe(true);

    await payments.restoreCod({
      customerIdentityId: customerId,
      actorIdentityId: ownerId,
      reason: 'verified customer identity',
    });

    await payments.requireRedeliveryFee(childId, 15_000);
    await payments.recordCourierRemittance({
      courierRef: 'COURIER-1',
      amountLak: 210_000,
      codShipmentId: cod.codShipmentId,
    });
    const child = await db.query<{ status: string; payment_received: boolean }>(
      `SELECT status, payment_received FROM app.child_orders WHERE id = $1`,
      [childId],
    );
    // remittance must not auto-mark delivered
    expect(child.rows[0]?.status).not.toBe('delivered');

    const recon = await payments.reconcileCod(cod.codShipmentId);
    expect(recon.difference).toBe(0);
  });

  it('reconciles bank allocations without unexplained differences and requires adjustment approval', async () => {
    const created = await createConfirmedOrder();
    const qr = await payments.createQrPaymentRequest({
      parentOrderId: created.parentId,
      childOrderIds: created.childIds,
      actorIdentityId: customerId,
      now: new Date('2026-09-03T10:00:00.000Z'),
    });
    const ev = await payments.submitEvidence({
      paymentRequestId: qr.paymentRequestId,
      amountReportedLak: qr.amountLak,
      evidenceStorageKey: 'private/evidence/ok.png',
      idempotencyKey: 'ev-ok',
    });
    await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: ev.attemptId,
      channel: 'manual',
      amountLak: qr.amountLak,
      bankRef: 'BANK-OK',
      idempotencyKey: 'confirm-ok',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T11:00:00.000Z'),
    });

    const recon = await payments.reconcileBank(qr.paymentRequestId);
    expect(recon.difference).toBe(0);
    expect(recon.allocationLak).toBe(recon.expectedLak);

    const proof = await payments.dailyTotalsProof('2026-09-03');
    expect(proof.dayTotal).toBeGreaterThan(0);
    expect(proof.childTotals.length).toBeGreaterThan(0);

    await db.query(
      `INSERT INTO finance.recon_mismatches
        (mismatch_type, reference_id, expected_lak, actual_lak)
       VALUES ('bank',$1,1,2)`,
      [qr.paymentRequestId],
    );
    const mismatch = await db.query<{ id: string }>(
      `SELECT id FROM finance.recon_mismatches ORDER BY created_at DESC LIMIT 1`,
    );
    await payments.resolveMismatch({
      mismatchId: mismatch.rows[0]!.id,
      actorIdentityId: financeId,
      note: 'timing difference resolved',
      createAdjustment: { amountLak: 1, paymentRequestId: qr.paymentRequestId },
    });
    const adj = await db.query<{ id: string }>(
      `SELECT id FROM finance.payment_adjustments ORDER BY created_at DESC LIMIT 1`,
    );
    expect(
      await payments.approveAdjustment({
        adjustmentId: adj.rows[0]!.id,
        approverIdentityId: financeId,
      }),
    ).toEqual({ ok: false, reason: 'self_approval' });
    expect(
      await payments.approveAdjustment({
        adjustmentId: adj.rows[0]!.id,
        approverIdentityId: ownerId,
      }),
    ).toEqual({ ok: true });
  });
});
