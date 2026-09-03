import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { OrderService } from '../orders/orderService.js';
import { PromotionService } from '../promotions/promotionService.js';
import { ContentService } from '../content/contentService.js';
import { CustomerPrivacyService } from '../customers/privacyService.js';
import { SupportService } from '../support/supportService.js';

describe('Milestone 8 promotions content customers support', () => {
  let db: PGlite;
  let promotions: PromotionService;
  let content: ContentService;
  let privacy: CustomerPrivacyService;
  let support: SupportService;
  let orders: OrderService;
  let sms: MockSmsProvider;
  let customerId: string;
  let staffId: string;
  let ownerId: string;
  let storeId: string;
  let productId: string;
  let variantId: string;

  async function activateStore() {
    const stores = new StoreService(db);
    const id = await stores.createStore({ code: 'M8-A', name: 'M8 Store' });
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

  async function createProduct() {
    const catalog = new CatalogService(db);
    const pricing = new PricingService(db);
    const pid = await catalog.createProduct({
      storeId,
      categorySlug: 'general',
      storeProductId: 'SP-M8',
      copy: { lo: { title: 'ສິນຄ້າ' }, en: { title: 'Item' } },
    });
    const vid = await catalog.createVariant({
      productId: pid,
      storeId,
      sku: 'M8-SKU',
      hasShelfLife: false,
    });
    await catalog.setStatus('products', pid, 'active');
    await catalog.setStatus('product_variants', vid, 'active');
    const proposed = await pricing.proposePrice({
      variantId: vid,
      costLak: 1000,
      sellingPriceLak: 100_000,
      makerIdentityId: staffId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    return { productId: pid, variantId: vid };
  }

  async function deliveredOrder() {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId, variantId, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const childId = created.childIds[0]!;
    await db.query(
      `UPDATE app.child_orders SET status = 'delivered', payment_received = true WHERE id = $1`,
      [childId],
    );
    return created;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    sms = new MockSmsProvider();
    const identity = new IdentityService(db, sms);
    customerId = await identity.ensureCustomer('+8562098000001', 'M8 Customer');
    staffId = (await identity.ensureStaff('staff:m8', 'Staff', '+8562088000001')).identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m8', 'Owner', '+8562088000002')).identityId;
    storeId = await activateStore();
    const sell = await createProduct();
    productId = sell.productId;
    variantId = sell.variantId;
    orders = new OrderService(db);
    promotions = new PromotionService(db);
    content = new ContentService(db);
    privacy = new CustomerPrivacyService(db, sms);
    support = new SupportService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies stacked promos with funding, alerts, hard cap, and cancel recalc', async () => {
    const cartId = await orders.createCart(customerId);
    await orders.addCartItem(cartId, { storeId, variantId, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });

    const platform = await promotions.createPromotion({
      code: 'PLAT10',
      titleLo: 'ສ່ວນຫຼຸດ',
      titleEn: 'Platform 10%',
      percentOff: 10,
      funding: 'platform',
      budgetLak: 50_000,
      allowStack: true,
      stackingGroup: 'platform',
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: new Date('2026-12-31'),
    });
    const supplier = await promotions.createPromotion({
      code: 'SUP5',
      titleLo: 'ຮ້ານ',
      titleEn: 'Supplier 5k',
      amountOffLak: 5_000,
      funding: 'supplier',
      budgetLak: 20_000,
      allowStack: true,
      stackingGroup: 'supplier',
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: new Date('2026-12-31'),
    });
    const applied = await promotions.applyToOrder({
      promotionIds: [platform, supplier],
      parentOrderId: created.parentId,
      subtotalLak: 100_000,
      idempotencyKey: `promo-${created.parentId}`,
    });
    expect(applied.discountLak).toBe(15_000);

    // burn remaining budget to trigger alerts / hard stop
    const tiny = await promotions.createPromotion({
      code: 'TINY',
      titleLo: 't',
      titleEn: 't',
      amountOffLak: 8_000,
      funding: 'split',
      platformFundBps: 5000,
      budgetLak: 10_000,
      quantityCap: 2,
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: new Date('2026-12-31'),
    });
    const c2 = await orders.checkout({
      cartId: await orders.createCart(customerId).then(async (id) => {
        await orders.addCartItem(id, { storeId, variantId, quantity: 1 });
        return id;
      }),
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    const first = await promotions.applyToOrder({
      promotionIds: [tiny],
      parentOrderId: c2.parentId,
      subtotalLak: 100_000,
      idempotencyKey: `tiny-1-${c2.parentId}`,
    });
    expect(first.notifications?.some((n) => n.template === 'promotion.budget_alert')).toBe(true);

    const c3 = await orders.checkout({
      cartId: await orders.createCart(customerId).then(async (id) => {
        await orders.addCartItem(id, { storeId, variantId, quantity: 1 });
        return id;
      }),
      customerIdentityId: customerId,
      actorIdentityId: customerId,
      correlationId: crypto.randomUUID(),
    });
    await expect(
      promotions.applyToOrder({
        promotionIds: [tiny],
        parentOrderId: c3.parentId,
        subtotalLak: 100_000,
        idempotencyKey: `tiny-2-${c3.parentId}`,
      }),
    ).rejects.toThrow('promotion_cap_exceeded');

    expect(
      promotions.recalculateOnCancel({
        originalDiscountLak: 15_000,
        originalSubtotalLak: 100_000,
        cancelledLineTotalLak: 50_000,
        percentOff: 10,
      }),
    ).toBe(5_000);
  });

  it('enforces verified reviews, edits, moderation, and tiktok allowlist', async () => {
    const created = await deliveredOrder();
    const review = await content.createReview({
      productId,
      childOrderId: created.childIds[0]!,
      customerIdentityId: customerId,
      rating: 5,
      bodyLo: 'ດີ',
      bodyEn: 'good',
      now: new Date(),
    });
    expect(review.verifiedPurchase).toBe(true);
    expect(review.status).toBe('published');

    const edited = await content.editReview({
      reviewId: review.reviewId,
      customerIdentityId: customerId,
      rating: 4,
      bodyEn: 'still good',
      now: new Date(),
    });
    expect(edited.versionNo).toBe(2);

    const response = await content.submitSupplierResponse({
      reviewId: review.reviewId,
      storeId,
      body: 'thanks',
    });
    expect(response.status).toBe('pending');
    await content.approveSupplierResponse({
      responseId: response.responseId,
      approverIdentityId: staffId,
    });

    const staffLink = await content.submitTikTokLink({
      url: 'https://www.tiktok.com/@shop/video/1',
      productId,
      submittedByType: 'staff',
      submittedBy: staffId,
    });
    expect(staffLink.status).toBe('published');

    const customerLink = await content.submitTikTokLink({
      url: 'https://www.tiktok.com/@shop/video/2',
      submittedByType: 'customer',
      submittedBy: customerId,
    });
    expect(customerLink.status).toBe('pending');
    await content.moderateTikTok({
      linkId: customerLink.linkId,
      approve: true,
      actorIdentityId: staffId,
    });

    await expect(
      content.submitTikTokLink({
        url: 'https://evil.example/phish',
        submittedByType: 'customer',
      }),
    ).rejects.toThrow('host_not_allowed');
  });

  it('manages addresses, phone OTP change, recovery, deletion anonymize, marketing opt-out', async () => {
    const addrId = await privacy.addAddress({
      customerIdentityId: customerId,
      recipientName: 'ນາງ ສົມ',
      recipientPhoneE164: '+8562098111111',
      addressLine: 'Ban Hatsady',
      isDefault: true,
    });
    const created = await deliveredOrder();
    await privacy.snapshotOrderAddress({
      parentOrderId: created.parentId,
      addressId: addrId,
    });
    await expect(
      db.query(`UPDATE app.order_address_snapshots SET address_line = 'x' WHERE parent_order_id = $1`, [
        created.parentId,
      ]),
    ).rejects.toThrow(/immutable/i);

    const storeView = await privacy.storeDeliveryView(storeId, created.parentId);
    expect(storeView).toEqual({
      recipientName: 'ນາງ ສົມ',
      recipientPhone: '+8562098111111',
      addressLine: 'Ban Hatsady',
    });

    const change = await privacy.startPhoneChange({
      customerIdentityId: customerId,
      oldPhone: '+8562098000001',
      newPhone: '+8562098222222',
    });
    await privacy.confirmPhoneChange({
      correlationId: change.correlationId,
      oldCode: change.oldCode,
      newCode: change.newCode,
      customerIdentityId: customerId,
    });
    const phone = await db.query<{ phone_e164: string }>(
      `SELECT phone_e164 FROM security.auth_identities WHERE id = $1`,
      [customerId],
    );
    expect(phone.rows[0]?.phone_e164).toBe('+8562098222222');

    const recoveryId = await privacy.submitRecoveryDocument({
      claimedPhone: '+8562098333333',
      documentStorageKey: 'private/recovery/doc.pdf',
    });
    expect(recoveryId).toBeTruthy();

    await privacy.setMarketingOptIn(customerId, false);
    const mkt = await db.query<{ marketing_opt_in: boolean }>(
      `SELECT marketing_opt_in FROM app.customer_profiles WHERE auth_identity_id = $1`,
      [customerId],
    );
    expect(mkt.rows[0]?.marketing_opt_in).toBe(false);

    // separate customer for deletion so other tests keep working
    const identity = new IdentityService(db, sms);
    const doomed = await identity.ensureCustomer('+8562098444444', 'Doomed');
    const del = await privacy.requestDeletion({
      customerIdentityId: doomed,
      otpVerified: true,
    });
    await privacy.approveAndAnonymizeDeletion({
      requestId: del,
      approverIdentityId: staffId,
    });
    const anon = await db.query<{ display_name: string; archived_at: string | null }>(
      `SELECT display_name, archived_at::text FROM app.customer_profiles WHERE auth_identity_id = $1`,
      [doomed],
    );
    expect(anon.rows[0]?.display_name).toBe('anonymized');
    expect(anon.rows[0]?.archived_at).toBeTruthy();
  });

  it('enforces support SLA, urgent escalation, auto-close, and reopen', async () => {
    const createdAt = new Date('2026-09-03T08:00:00.000Z');
    const urgent = await support.openTicket({
      customerIdentityId: customerId,
      channel: 'whatsapp',
      externalRef: 'wa:123',
      subject: 'Payment issue',
      body: 'help',
      urgency: 'urgent',
      now: createdAt,
    });
    expect(urgent.resolutionDueAt.startsWith('2026-09-08')).toBe(true);

    const general = await support.openTicket({
      customerIdentityId: customerId,
      channel: 'in_app',
      subject: 'Question',
      body: 'hi',
      now: createdAt,
    });
    const breach = await support.evaluateSla(
      general.ticketId,
      new Date('2026-09-04T00:00:00.000Z'),
    );
    expect(breach.breaches).toContain('first_response');
    expect(breach.escalated).toBe(true);

    await support.staffReply({
      ticketId: general.ticketId,
      staffIdentityId: staffId,
      body: 'we are looking',
      now: new Date('2026-09-04T01:00:00.000Z'),
    });
    await support.markPreliminaryResolved(
      general.ticketId,
      new Date('2026-09-05T00:00:00.000Z'),
    );
    const auto = await support.autoCloseIfStale(
      general.ticketId,
      new Date('2026-09-09T00:00:00.000Z'),
    );
    expect(auto.closed).toBe(true);

    await support.reopen(general.ticketId, customerId, 'still broken');
    const status = await db.query<{ status: string }>(
      `SELECT status FROM app.support_tickets WHERE id = $1`,
      [general.ticketId],
    );
    expect(status.rows[0]?.status).toBe('reopened');
  });
});
