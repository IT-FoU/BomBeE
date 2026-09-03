import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { parseEnv } from '@bombee/config';
import { APP_ROLES } from '@bombee/shared';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { decideApproval } from '../rbac/makerChecker.js';
import { evaluatePermissions, hasPermission } from '../rbac/permissions.js';
import { PaymentService } from '../payments/paymentService.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { PricingService } from '../catalog/pricingService.js';
import { OrderService } from '../orders/orderService.js';
import { BackupService } from '../backup/backupService.js';
import { ReportService } from '../reports/reportService.js';
import { createAppRouter } from '../../app.js';

describe('Milestone 10 security audit', () => {
  let db: PGlite;
  let identity: IdentityService;
  let sms: MockSmsProvider;
  let customerA: string;
  let customerB: string;
  let financeId: string;
  let ownerId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    sms = new MockSmsProvider();
    identity = new IdentityService(db, sms);
    customerA = await identity.ensureCustomer('+8562090100001', 'A');
    customerB = await identity.ensureCustomer('+8562090100002', 'B');
    financeId = (await identity.ensureStaff('staff:fin-m10', 'Finance', '+8562080100001'))
      .identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m10', 'Owner', '+8562080100002'))
      .identityId;
  });

  afterAll(async () => {
    await db.close();
  });

  it('covers IDOR/BOLA style cross-customer isolation via RLS', async () => {
    const profileA = await db.query<{ id: string }>(
      `SELECT id FROM app.customer_profiles WHERE auth_identity_id = $1`,
      [customerA],
    );
    await db.exec(`SET ROLE bombee_authenticated`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [customerB]);
    const visible = await db.query<{ id: string }>(`SELECT id FROM app.customer_profiles`);
    expect(visible.rows.find((r) => r.id === profileA.rows[0]!.id)).toBeUndefined();
    await db.exec(`RESET ROLE`);
  });

  it('blocks privilege escalation via self-approval and grants backoffice access by role', async () => {
    for (const role of APP_ROLES) {
      const granted = evaluatePermissions({ roles: [role], overrides: [] });
      expect(hasPermission(granted, 'backoffice.access')).toBe(true);
    }
    const self = decideApproval({
      request: {
        id: 'r-m10',
        approvalType: 'exports.approve',
        makerIdentityId: financeId,
        status: 'pending',
        requiresOwner: false,
        requires2fa: false,
      },
      actorIdentityId: financeId,
      actorRoles: ['owner'],
      delegations: [],
      stepUpVerified: true,
      now: Date.now(),
    });
    expect(self).toEqual({ ok: false, reason: 'self_approval' });
  });

  it('enforces session theft mitigation via revoke-all', async () => {
    const sessionId = await identity.createSession({
      authIdentityId: ownerId,
      audience: 'backoffice',
      ttlMs: 3_600_000,
    });
    await identity.revokeAllSessions(ownerId, 'suspected_theft');
    const rows = await db.query<{ revoked_at: string | null }>(
      `SELECT revoked_at::text FROM security.sessions WHERE id = $1`,
      [sessionId],
    );
    expect(rows.rows[0]?.revoked_at).toBeTruthy();
  });

  it('rate limits OTP and rejects non-private recovery file paths', async () => {
    const phone = '+8562090100099';
    await identity.ensureCustomer(phone, 'Rate');
    let limited = false;
    for (let i = 0; i < 8; i += 1) {
      const res = await identity.requestOtp({
        phoneE164: phone,
        purpose: 'customer_login',
        correlationId: crypto.randomUUID(),
        now: 1_000 + i * 1_000,
      });
      if ('limited' in res && res.limited) limited = true;
    }
    expect(limited).toBe(true);

    const { CustomerPrivacyService } = await import('../customers/privacyService.js');
    const privacy = new CustomerPrivacyService(db, sms);
    await expect(
      privacy.submitRecoveryDocument({
        claimedPhone: '+8562090100088',
        documentStorageKey: 'public/leak.pdf',
      }),
    ).rejects.toThrow('recovery_doc_must_be_private');
  });

  it('rejects duplicate payment confirmations (replayed webhook)', async () => {
    const stores = new StoreService(db);
    const storeId = await stores.createStore({ code: 'M10-A', name: 'M10' });
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
    const catalog = new CatalogService(db);
    const pricing = new PricingService(db);
    const productId = await catalog.createProduct({
      storeId,
      categorySlug: 'general',
      storeProductId: 'SP-M10',
      copy: { lo: { title: 'x' }, en: { title: 'x' } },
    });
    const variantId = await catalog.createVariant({
      productId,
      storeId,
      sku: 'M10-SKU',
      hasShelfLife: false,
    });
    await catalog.setStatus('products', productId, 'active');
    await catalog.setStatus('product_variants', variantId, 'active');
    const proposed = await pricing.proposePrice({
      variantId,
      costLak: 100,
      sellingPriceLak: 50_000,
      makerIdentityId: financeId,
    });
    await pricing.approvePrice({
      requestId: proposed.requestId,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: false,
    });
    const orders = new OrderService(db);
    const cartId = await orders.createCart(customerA);
    await orders.addCartItem(cartId, { storeId, variantId, quantity: 1 });
    const created = await orders.checkout({
      cartId,
      customerIdentityId: customerA,
      actorIdentityId: customerA,
      correlationId: crypto.randomUUID(),
    });
    await orders.transitionChild({
      childOrderId: created.childIds[0]!,
      toStatus: 'confirmed',
      actorIdentityId: ownerId,
      reason: 'ok',
      correlationId: crypto.randomUUID(),
    });
    const payments = new PaymentService(db);
    const qr = await payments.createQrPaymentRequest({
      parentOrderId: created.parentId,
      childOrderIds: created.childIds,
      actorIdentityId: customerA,
      now: new Date('2026-09-03T08:00:00.000Z'),
    });
    const evidence = await payments.submitEvidence({
      paymentRequestId: qr.paymentRequestId,
      amountReportedLak: qr.amountLak,
      evidenceStorageKey: 'private/ev.png',
      idempotencyKey: 'm10-ev',
    });
    const first = await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: evidence.attemptId,
      channel: 'bank_api',
      amountLak: qr.amountLak,
      bankRef: 'WEBHOOK-M10',
      idempotencyKey: 'm10-confirm',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:00:00.000Z'),
    });
    expect(first.ok).toBe(true);
    const replay = await payments.confirmPayment({
      paymentRequestId: qr.paymentRequestId,
      attemptId: evidence.attemptId,
      channel: 'bank_api',
      amountLak: qr.amountLak,
      bankRef: 'WEBHOOK-M10',
      idempotencyKey: 'm10-confirm-replay',
      actorIdentityId: financeId,
      now: new Date('2026-09-03T09:01:00.000Z'),
    });
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    const receipts = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance.payment_receipts r
       JOIN finance.payment_attempts a ON a.id = r.payment_attempt_id
       WHERE a.payment_request_id = $1`,
      [qr.paymentRequestId],
    );
    expect(receipts.rows[0]?.n).toBe(1);
  });

  it('runs backup restore drill and report reconcile as incident evidence', async () => {
    const backups = new BackupService(db);
    const job = await backups.runBackup({ jobType: 'daily_critical' });
    expect(job.status).toBe('completed');
    const drill = await backups.restoreDrill(job.jobId);
    expect(drill.ok).toBe(true);
    const reports = new ReportService(db);
    const recon = await reports.reconcilePayments({ actorRoles: ['finance'] });
    expect(recon.ok).toBe(true);
  });

  it('keeps production capabilities free of mock SMS and EGO traffic', async () => {
    const prod = parseEnv({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example.com',
      PUBLIC_CUSTOMER_URL: 'https://shop.example.com',
      PUBLIC_BACKOFFICE_URL: 'https://admin.example.com',
      EGO_POS_ENABLED: 'false',
    });
    expect(prod.EGO_POS_ENABLED).toBe(false);
    expect(() =>
      parseEnv({
        APP_ENV: 'production',
        NODE_ENV: 'production',
        PUBLIC_API_URL: 'https://api.example.com',
        PUBLIC_CUSTOMER_URL: 'https://shop.example.com',
        PUBLIC_BACKOFFICE_URL: 'https://admin.example.com',
        EGO_POS_ENABLED: 'true',
      }),
    ).toThrow(/EGO POS must remain disabled/);

    const router = createAppRouter(prod);
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 0,
      writeHead(status: number) {
        this.statusCode = status;
      },
      setHeader() {},
      end(body?: string | Buffer) {
        if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      },
    } as unknown as import('node:http').ServerResponse;
    await router(
      {
        method: 'GET',
        url: '/v1/auth/capabilities',
        headers: { host: 'localhost' },
      } as import('node:http').IncomingMessage,
      res,
    );
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      smsProvider: string;
      egoPosEnabled: boolean;
      inviteOnlyEnabled: boolean;
      integrationsMode: string;
      productionHold: boolean;
    };
    // Phase 1: Production APP_ENV still uses sandbox until Owner opens live credentials
    expect(body.smsProvider).toBe('sandbox');
    expect(body.integrationsMode).toBe('sandbox');
    expect(body.egoPosEnabled).toBe(false);
    expect(body.inviteOnlyEnabled).toBe(true);
    expect(body.productionHold).toBe(true);
  });
});
