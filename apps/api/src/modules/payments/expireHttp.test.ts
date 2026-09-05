import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseEnv } from '@bombee/config';

import { createAppRouter } from '../../app.js';
import { createLocalApiServices, type ApiServices } from '../../runtime/createServices.js';

function mockRes() {
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
  } as unknown as ServerResponse & { statusCode: number };
  return {
    res,
    body: () => JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
  };
}

function mockReq(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const stream = {
    method,
    url,
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  return stream as unknown as IncomingMessage;
}

describe('payment mock-expire-due HTTP', () => {
  const env = parseEnv({
    APP_ENV: 'local',
    PUBLIC_API_URL: 'http://localhost:8787',
    PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
    PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
    EGO_POS_ENABLED: 'false',
    INTEGRATIONS_MODE: 'mock',
  });
  let services: ApiServices;
  let router: ReturnType<typeof createAppRouter>;
  let token: string;

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
    const identityId = await services.identity.ensureCustomer('+8562097224001', 'Expire QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('expires due QR payments and releases reserved stock', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      storeId: string;
      variants: Array<{ id: string }>;
    }>;
    const product = products[0]!;
    const variant = product.variants[0]!;

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockBefore.res);
    const availableBefore = Number(stockBefore.body().availableQty);

    const cartRes = mockRes();
    await router(
      mockReq('POST', '/v1/carts', {}, { authorization: `Bearer ${token}` }),
      cartRes.res,
    );
    const cartId = cartRes.body().cartId as string;
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/items`,
        { storeId: product.storeId, variantId: variant.id, quantity: 1 },
        { authorization: `Bearer ${token}` },
      ),
      mockRes().res,
    );
    const checkoutRes = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/checkout`,
        { shippingLakByStore: { [product.storeId]: 5000 } },
        { authorization: `Bearer ${token}` },
      ),
      checkoutRes.res,
    );
    const parentId = checkoutRes.body().parentId as string;

    await router(
      mockReq('POST', `/v1/orders/${parentId}/confirm-children`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockRes().res,
    );
    const qr = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/qr`, {}, {
        authorization: `Bearer ${token}`,
      }),
      qr.res,
    );
    expect(qr.res.statusCode).toBe(201);
    const paymentRequestId = qr.body().paymentRequestId as string;
    const reservations = qr.body().reservations as Array<{ reservationId: string }>;
    expect(reservations.length).toBeGreaterThan(0);

    const stockReserved = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockReserved.res);
    expect(Number(stockReserved.body().availableQty)).toBe(availableBefore - 1);

    await services.db.query(
      `UPDATE finance.payment_requests
       SET expires_at = '2026-01-01T00:00:00.000Z'
       WHERE id = $1`,
      [paymentRequestId],
    );

    const expire = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/payments/mock-expire-due',
        { now: '2026-09-04T12:00:00.000Z' },
        { authorization: `Bearer ${token}` },
      ),
      expire.res,
    );
    expect(expire.res.statusCode).toBe(200);
    const payments = expire.body().payments as Array<{
      paymentRequestId: string;
      status?: string;
      releasedReservationIds: string[];
    }>;
    const hit = payments.find((p) => p.paymentRequestId === paymentRequestId);
    expect(hit?.status).toBe('expired');
    expect(hit?.releasedReservationIds.length).toBeGreaterThan(0);
    expect(hit?.cancelledChildIds.length).toBeGreaterThan(0);

    const status = mockRes();
    await router(
      mockReq('GET', `/v1/payments/${paymentRequestId}`, undefined, {
        authorization: `Bearer ${token}`,
      }),
      status.res,
    );
    expect((status.body().payment as { status: string }).status).toBe('expired');

    const order = mockRes();
    await router(
      mockReq('GET', `/v1/orders/${parentId}`, undefined, {
        authorization: `Bearer ${token}`,
      }),
      order.res,
    );
    const byStore = order.body().byStore as Array<{ status: string }>;
    expect(byStore.every((c) => c.status === 'cancelled')).toBe(true);

    const stockAfter = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockAfter.res);
    expect(Number(stockAfter.body().availableQty)).toBe(availableBefore);
  });

  it('expires a single payment request via ops mock-expire-request', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      storeId: string;
      variants: Array<{ id: string }>;
    }>;
    const product = products[0]!;
    const variant = product.variants[0]!;

    const cartRes = mockRes();
    await router(
      mockReq('POST', '/v1/carts', {}, { authorization: `Bearer ${token}` }),
      cartRes.res,
    );
    const cartId = cartRes.body().cartId as string;
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/items`,
        { storeId: product.storeId, variantId: variant.id, quantity: 1 },
        { authorization: `Bearer ${token}` },
      ),
      mockRes().res,
    );
    const checkoutRes = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/checkout`,
        { shippingLakByStore: { [product.storeId]: 5000 } },
        { authorization: `Bearer ${token}` },
      ),
      checkoutRes.res,
    );
    const parentId = checkoutRes.body().parentId as string;
    await router(
      mockReq('POST', `/v1/orders/${parentId}/confirm-children`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockRes().res,
    );
    const qr = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/qr`, {}, {
        authorization: `Bearer ${token}`,
      }),
      qr.res,
    );
    expect(qr.res.statusCode).toBe(201);
    const paymentRequestId = qr.body().paymentRequestId as string;
    expect(paymentRequestId).toBeTruthy();

    const blocked = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payments/mock-expire-request', {
        payment_request_id: paymentRequestId,
        force: false,
      }),
      blocked.res,
    );
    expect(blocked.res.statusCode).toBe(409);
    expect(blocked.body().error).toBe('not_due');

    const expired = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payments/mock-expire-request', {
        payment_request_id: paymentRequestId,
        force: true,
        now: '2026-09-05T12:00:00.000Z',
      }),
      expired.res,
    );
    expect(expired.res.statusCode).toBe(200);
    expect(expired.body().ok).toBe(true);
    expect(expired.body().status).toBe('expired');
    expect(expired.body().paymentRequestId).toBe(paymentRequestId);
    expect((expired.body().payment as { status: string }).status).toBe('expired');

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payments/mock-expire-request', {
        payment_request_id: paymentRequestId,
        force: true,
      }),
      again.res,
    );
    expect(again.res.statusCode).toBe(200);
    expect(again.body().ok).toBe(true);
    expect(again.body().status).toBe('expired');
  });

});
