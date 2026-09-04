import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME, CURRENCY_CODE, DISPLAY_TIMEZONE } from '@bombee/shared';

import { readJsonBody } from './http/readJsonBody.js';
import { applyCors } from './http/cors.js';
import { getHealth } from './modules/system/health.js';
import type { ApiServices } from './runtime/createServices.js';
import { evaluateInviteAccess, type InviteRole } from './modules/staging/inviteService.js';

export function createAppRouter(env: BombeeEnv, services: ApiServices) {
  return async function appRouter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const preflight = applyCors(env, req, res);
    if (preflight.handledPreflight) return;

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, getHealth(env));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/capabilities') {
      sendJson(res, 200, {
        smsProvider:
          env.INTEGRATIONS_MODE === 'mock'
            ? 'mock'
            : env.INTEGRATIONS_MODE === 'sandbox'
              ? 'sandbox'
              : 'external',
        backofficeIdleSeconds: 3600,
        maxFailedLogins: 5,
        egoPosEnabled: env.EGO_POS_ENABLED,
        inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
        integrationsMode: env.INTEGRATIONS_MODE,
        auditRetentionYears: 5,
        productionDeployAuthorized: env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        productionHold: !env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        otpHttpEnabled: true,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/otp/request') {
      const body = await readJsonBody<{
        phoneE164?: string;
        purpose?: string;
        inviteCode?: string;
      }>(req);
      const phoneE164 = body.phoneE164?.trim();
      if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
        sendJson(res, 400, { error: 'invalid_phone' });
        return;
      }

      if (env.INVITE_ONLY_ENABLED) {
        const inviteCode = body.inviteCode?.trim();
        if (!inviteCode) {
          sendJson(res, 403, { error: 'invite_required' });
          return;
        }
        const invite = await services.invites.findByCode(inviteCode);
        const access = evaluateInviteAccess({
          inviteOnlyEnabled: true,
          invite,
        });
        if (!access.allowed) {
          sendJson(res, 403, { error: access.reason });
          return;
        }
      }

      const purpose = body.purpose === 'staff_login' ? 'staff_login' : 'customer_login';
      if (purpose === 'customer_login') {
        await services.identity.ensureCustomer(phoneE164, `Customer ${phoneE164.slice(-4)}`);
      }
      const correlationId = crypto.randomUUID();
      const result = await services.identity.requestOtp({
        phoneE164,
        purpose,
        correlationId,
      });
      const payload: Record<string, unknown> = { ...result };
      // Local/mock only — never expose OTP codes outside local APP_ENV
      if (env.APP_ENV === 'local' && env.INTEGRATIONS_MODE === 'mock') {
        const last = services.sms.sent.at(-1);
        if (last && last.phoneE164 === phoneE164) {
          payload.devCode = last.code;
        }
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/otp/verify') {
      const body = await readJsonBody<{
        phoneE164?: string;
        code?: string;
        purpose?: string;
        inviteCode?: string;
      }>(req);
      const phoneE164 = body.phoneE164?.trim();
      const code = body.code?.trim();
      if (!phoneE164 || !code) {
        sendJson(res, 400, { error: 'invalid_request' });
        return;
      }
      const purpose = body.purpose === 'staff_login' ? 'staff_login' : 'customer_login';
      const verified = await services.identity.verifyOtp({ phoneE164, purpose, code });
      if (!verified.ok) {
        sendJson(res, 401, { error: verified.reason });
        return;
      }
      const identityId =
        purpose === 'customer_login'
          ? await services.identity.ensureCustomer(phoneE164, `Customer ${phoneE164.slice(-4)}`)
          : (
              await services.db.query<{ id: string }>(
                `SELECT id FROM security.auth_identities WHERE phone_e164 = $1 LIMIT 1`,
                [phoneE164],
              )
            ).rows[0]?.id;
      if (!identityId) {
        sendJson(res, 401, { error: 'identity_missing' });
        return;
      }

      const inviteCode = body.inviteCode?.trim();
      if (env.INVITE_ONLY_ENABLED || inviteCode) {
        if (!inviteCode) {
          sendJson(res, 403, { error: 'invite_required' });
          return;
        }
        const redeemed = await services.invites.redeem({
          inviteCode,
          inviteOnlyEnabled: env.INVITE_ONLY_ENABLED || Boolean(inviteCode),
          identityId,
          phoneE164,
        });
        if (!redeemed.allowed) {
          sendJson(res, 403, { error: redeemed.reason });
          return;
        }
      }

      const sessionId = await services.identity.createSession({
        authIdentityId: identityId,
        audience: purpose === 'staff_login' ? 'backoffice' : 'customer',
        ttlMs: 7 * 24 * 60 * 60_000,
      });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
      sendJson(res, 200, {
        ok: true,
        sessionToken: sessionId,
        expiresAt,
        identityId,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
      if (!token) {
        sendJson(res, 401, { error: 'missing_token' });
        return;
      }
      const session = await services.identity.getSession(token);
      if (!session) {
        sendJson(res, 401, { error: 'invalid_session' });
        return;
      }
      sendJson(res, 200, { ok: true, ...session });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
      const body = await readJsonBody<{ sessionToken?: string }>(req);
      const auth = req.headers.authorization ?? '';
      const token =
        body.sessionToken?.trim() ||
        (auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '');
      if (!token) {
        sendJson(res, 400, { error: 'missing_token' });
        return;
      }
      await services.identity.revokeSession(token, 'logout');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/invites') {
      const rows = await services.invites.listInvites();
      sendJson(res, 200, { ok: true, invites: rows });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/invites') {
      const body = await readJsonBody<{
        inviteCode?: string;
        intendedRole?: InviteRole;
        maxUses?: number;
        note?: string;
        phoneE164?: string;
      }>(req);
      const inviteCode = body.inviteCode?.trim().toUpperCase();
      if (!inviteCode || !/^[A-Z0-9-]{4,32}$/.test(inviteCode)) {
        sendJson(res, 400, { error: 'invalid_invite_code' });
        return;
      }
      const role = body.intendedRole ?? 'customer';
      if (!['customer', 'store_owner', 'ops', 'admin'].includes(role)) {
        sendJson(res, 400, { error: 'invalid_role' });
        return;
      }
      try {
        const invite = await services.invites.createInvite({
          inviteCode,
          intendedRole: role,
          maxUses: body.maxUses && body.maxUses > 0 ? Math.min(body.maxUses, 100) : 1,
          note: body.note?.trim() || null,
          phoneE164: body.phoneE164?.trim() || null,
        });
        sendJson(res, 201, { ok: true, invite });
      } catch {
        sendJson(res, 409, { error: 'invite_code_taken' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores') {
      const rows = await services.stores.listStores();
      sendJson(res, 200, { ok: true, stores: rows });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/stores') {
      const body = await readJsonBody<{ name?: string; code?: string }>(req);
      const name = body.name?.trim();
      if (!name || name.length < 2) {
        sendJson(res, 400, { error: 'invalid_store_name' });
        return;
      }
      const code =
        body.code?.trim().toUpperCase() ||
        `${name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '')
          .slice(0, 8) || 'STORE'}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
        sendJson(res, 400, { error: 'invalid_store_code' });
        return;
      }
      try {
        const storeId = await services.stores.createStore({ code, name });
        sendJson(res, 201, { ok: true, store: { id: storeId, code, name, status: 'onboarding' } });
      } catch {
        sendJson(res, 409, { error: 'store_code_taken' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/categories') {
      const categories = await services.catalog.listCategories();
      sendJson(res, 200, { ok: true, categories });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/products') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
      const products = await services.catalog.listActiveProducts(limit);
      const withStock = [];
      for (const product of products) {
        const primary = product.variants[0];
        const availableQty = primary
          ? await services.inventory.availableQtyForVariant(primary.id)
          : 0;
        withStock.push({ ...product, availableQty });
      }
      sendJson(res, 200, { ok: true, products: withStock });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/inventory/stock') {
      const variantId = url.searchParams.get('variantId')?.trim();
      if (!variantId) {
        sendJson(res, 400, { error: 'variant_id_required' });
        return;
      }
      const stock = await services.inventory.listStockByVariant(variantId);
      sendJson(res, 200, { ok: true, ...stock });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/carts') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = await services.orders.createCart(session.identityId);
      sendJson(res, 201, { ok: true, cartId });
      return;
    }

    const cartItemsMatch = url.pathname.match(/^\/v1\/carts\/([^/]+)\/items$/);
    if (req.method === 'POST' && cartItemsMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = decodeURIComponent(cartItemsMatch[1]!);
      const owned = await cartOwnedBy(services, cartId, session.identityId);
      if (!owned) {
        sendJson(res, 403, { error: 'cart_forbidden' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        variantId?: string;
        quantity?: number;
      }>(req);
      if (!body.storeId || !body.variantId || !body.quantity || body.quantity < 1) {
        sendJson(res, 400, { error: 'invalid_cart_item' });
        return;
      }
      await services.orders.addCartItem(cartId, {
        storeId: body.storeId,
        variantId: body.variantId,
        quantity: body.quantity,
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    const cartCheckoutMatch = url.pathname.match(/^\/v1\/carts\/([^/]+)\/checkout$/);
    if (req.method === 'POST' && cartCheckoutMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = decodeURIComponent(cartCheckoutMatch[1]!);
      const owned = await cartOwnedBy(services, cartId, session.identityId);
      if (!owned) {
        sendJson(res, 403, { error: 'cart_forbidden' });
        return;
      }
      const body = await readJsonBody<{ shippingLakByStore?: Record<string, number> }>(req);
      try {
        const result = await services.orders.checkout({
          cartId,
          customerIdentityId: session.identityId,
          actorIdentityId: session.identityId,
          shippingLakByStore: body.shippingLakByStore,
          correlationId: crypto.randomUUID(),
        });
        sendJson(res, 201, { ok: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'checkout_failed';
        const status =
          message === 'cart_empty' ||
          message === 'variant_not_active' ||
          message === 'store_not_accepting_orders' ||
          message === 'price_not_approved'
            ? 409
            : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const orderMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (req.method === 'GET' && orderMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(orderMatch[1]!);
      const owner = await services.db.query<{ customer_identity_id: string }>(
        `SELECT customer_identity_id FROM app.parent_orders WHERE id = $1`,
        [parentId],
      );
      const row = owner.rows[0];
      if (!row) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      if (row.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const views = await services.orders.getOrderViews(parentId);
      sendJson(res, 200, { ok: true, ...views });
      return;
    }

    const confirmChildrenMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/confirm-children$/);
    if (req.method === 'POST' && confirmChildrenMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(confirmChildrenMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      const children = await services.db.query<{ id: string }>(
        `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
        [parentId],
      );
      const wanted = new Set(body.childOrderIds ?? children.rows.map((c) => c.id));
      const confirmed: string[] = [];
      for (const child of children.rows) {
        if (!wanted.has(child.id)) continue;
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'confirmed',
          actorIdentityId: session.identityId,
          reason: 'local_mock_supplier_confirm',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          sendJson(res, 409, { error: result.reason, childOrderId: child.id });
          return;
        }
        confirmed.push(child.id);
      }
      sendJson(res, 200, { ok: true, confirmedChildIds: confirmed });
      return;
    }

    const createQrMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/payments\/qr$/);
    if (req.method === 'POST' && createQrMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(createQrMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      let childOrderIds = body.childOrderIds;
      if (!childOrderIds || childOrderIds.length === 0) {
        const children = await services.db.query<{ id: string }>(
          `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
          [parentId],
        );
        childOrderIds = children.rows.map((c) => c.id);
      }
      try {
        const qr = await services.payments.createQrPaymentRequest({
          parentOrderId: parentId,
          childOrderIds,
          actorIdentityId: session.identityId,
        });
        sendJson(res, 201, { ok: true, ...qr });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'qr_create_failed';
        sendJson(res, message === 'qr_requires_supplier_confirmation' ? 409 : 400, {
          error: message,
        });
      }
      return;
    }

    const paymentMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (req.method === 'GET' && paymentMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const paymentRequestId = decodeURIComponent(paymentMatch[1]!);
      const row = await services.db.query<{
        id: string;
        parent_order_id: string;
        reference_code: string;
        method: string;
        amount_lak: number;
        status: string;
        expires_at: string;
        customer_identity_id: string;
      }>(
        `SELECT pr.id, pr.parent_order_id, pr.reference_code, pr.method,
                pr.amount_lak, pr.status, pr.expires_at::text,
                po.customer_identity_id
         FROM finance.payment_requests pr
         JOIN app.parent_orders po ON po.id = pr.parent_order_id
         WHERE pr.id = $1`,
        [paymentRequestId],
      );
      const payment = row.rows[0];
      if (!payment) {
        sendJson(res, 404, { error: 'payment_not_found' });
        return;
      }
      if (payment.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'payment_forbidden' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        payment: {
          paymentRequestId: payment.id,
          parentOrderId: payment.parent_order_id,
          referenceCode: payment.reference_code,
          method: payment.method,
          amountLak: Number(payment.amount_lak),
          status: payment.status,
          expiresAt: payment.expires_at,
        },
      });
      return;
    }

    const mockConfirmMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)\/mock-confirm$/);
    if (req.method === 'POST' && mockConfirmMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const paymentRequestId = decodeURIComponent(mockConfirmMatch[1]!);
      const owned = await services.db.query<{
        amount_lak: number;
        customer_identity_id: string;
        reference_code: string;
      }>(
        `SELECT pr.amount_lak, po.customer_identity_id, pr.reference_code
         FROM finance.payment_requests pr
         JOIN app.parent_orders po ON po.id = pr.parent_order_id
         WHERE pr.id = $1`,
        [paymentRequestId],
      );
      const payment = owned.rows[0];
      if (!payment) {
        sendJson(res, 404, { error: 'payment_not_found' });
        return;
      }
      if (payment.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'payment_forbidden' });
        return;
      }
      const amountLak = Number(payment.amount_lak);
      const evidence = await services.payments.submitEvidence({
        paymentRequestId,
        amountReportedLak: amountLak,
        evidenceStorageKey: `mock/evidence/${paymentRequestId}.png`,
        idempotencyKey: `mock-evidence-${paymentRequestId}`,
      });
      const confirmed = await services.payments.confirmPayment({
        paymentRequestId,
        attemptId: evidence.attemptId,
        channel: 'manual',
        amountLak,
        bankRef: `MOCK-${payment.reference_code}`,
        idempotencyKey: `mock-confirm-${paymentRequestId}`,
        actorIdentityId: session.identityId,
      });
      if (!confirmed.ok) {
        sendJson(res, 409, { error: confirmed.reason });
        return;
      }
      sendJson(res, 200, { ok: true, paymentRequestId, status: 'paid' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(res, 200, {
        name: BRAND_NAME,
        currency: CURRENCY_CODE,
        timezone: DISPLAY_TIMEZONE,
        env: env.APP_ENV,
        egoPosEnabled: env.EGO_POS_ENABLED,
        inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
        integrationsMode: env.INTEGRATIONS_MODE,
        productionDeployAuthorized: env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        productionHold: !env.OWNER_PRODUCTION_DEPLOY_APPROVED,
      });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(Buffer.byteLength(payload)));
  res.end(payload);
}

async function requireCustomerSession(req: IncomingMessage, services: ApiServices) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  const session = await services.identity.getSession(token);
  if (!session || session.audience !== 'customer') return null;
  return session;
}

async function cartOwnedBy(services: ApiServices, cartId: string, identityId: string) {
  const row = await services.db.query<{ customer_identity_id: string }>(
    `SELECT customer_identity_id FROM app.carts WHERE id = $1`,
    [cartId],
  );
  return row.rows[0]?.customer_identity_id === identityId;
}

async function parentOwnedBy(services: ApiServices, parentId: string, identityId: string) {
  const row = await services.db.query<{ customer_identity_id: string }>(
    `SELECT customer_identity_id FROM app.parent_orders WHERE id = $1`,
    [parentId],
  );
  return row.rows[0]?.customer_identity_id === identityId;
}

function mockOpsAllowed(env: BombeeEnv): boolean {
  return env.INTEGRATIONS_MODE === 'mock' || env.APP_ENV === 'local';
}
