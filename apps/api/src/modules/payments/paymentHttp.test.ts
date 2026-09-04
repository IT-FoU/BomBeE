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

describe('payment QR HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097222001', 'Pay QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('confirms children, creates QR, and mock-confirms payment', async () => {
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
    expect(checkoutRes.res.statusCode).toBe(201);
    const parentId = checkoutRes.body().parentId as string;

    const blockedQr = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/qr`, {}, {
        authorization: `Bearer ${token}`,
      }),
      blockedQr.res,
    );
    expect(blockedQr.res.statusCode).toBe(409);
    expect(blockedQr.body().error).toBe('qr_requires_supplier_confirmation');

    const confirm = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/confirm-children`, {}, {
        authorization: `Bearer ${token}`,
      }),
      confirm.res,
    );
    expect(confirm.res.statusCode).toBe(200);
    expect((confirm.body().confirmedChildIds as string[]).length).toBeGreaterThan(0);

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockBefore.res);
    const availableBefore = Number(stockBefore.body().availableQty);

    const qr = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/qr`, {}, {
        authorization: `Bearer ${token}`,
      }),
      qr.res,
    );
    expect(qr.res.statusCode).toBe(201);
    const paymentRequestId = qr.body().paymentRequestId as string;
    expect(qr.body().referenceCode).toMatch(/^QR-/);
    expect(Number(qr.body().amountLak)).toBeGreaterThan(0);
    const reservations = qr.body().reservations as Array<{ reservationId: string; quantity: number }>;
    expect(reservations.length).toBeGreaterThan(0);

    const stockAfter = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockAfter.res);
    expect(Number(stockAfter.body().availableQty)).toBe(
      availableBefore - reservations.reduce((sum, r) => sum + r.quantity, 0),
    );

    const mockPaid = mockRes();
    await router(
      mockReq('POST', `/v1/payments/${paymentRequestId}/mock-confirm`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockPaid.res,
    );
    expect(mockPaid.res.statusCode).toBe(200);
    expect(mockPaid.body().status).toBe('paid');

    const status = mockRes();
    await router(
      mockReq('GET', `/v1/payments/${paymentRequestId}`, undefined, {
        authorization: `Bearer ${token}`,
      }),
      status.res,
    );
    expect(status.res.statusCode).toBe(200);
    expect((status.body().payment as { status: string }).status).toBe('paid');
  });
});
