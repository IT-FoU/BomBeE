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

describe('payment bank reconcile + daily totals HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097222068', 'Bank Recon QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  async function paidPaymentRequestId(): Promise<string> {
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

    const mockPaid = mockRes();
    await router(
      mockReq('POST', `/v1/payments/${paymentRequestId}/mock-confirm`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockPaid.res,
    );
    expect(mockPaid.res.statusCode).toBe(200);
    return paymentRequestId;
  }

  it('reconciles bank by id and latest, and returns daily totals proof', async () => {
    const paymentRequestId = await paidPaymentRequestId();

    const byId = mockRes();
    await router(
      mockReq('POST', `/v1/ops/payments/${paymentRequestId}/reconcile-bank`, {}),
      byId.res,
    );
    expect(byId.res.statusCode).toBe(200);
    expect(byId.body().ok).toBe(true);
    expect(byId.body().paymentRequestId).toBe(paymentRequestId);
    expect(Number(byId.body().expectedLak)).toBeGreaterThan(0);
    expect(Number(byId.body().actualLak)).toBe(Number(byId.body().expectedLak));
    expect(Number(byId.body().difference)).toBe(0);

    const latest = mockRes();
    await router(mockReq('POST', '/v1/ops/payments/reconcile-bank', {}), latest.res);
    expect(latest.res.statusCode).toBe(200);
    expect(latest.body().paymentRequestId).toBe(paymentRequestId);

    const missing = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payments/00000000-0000-4000-8000-000000000068/reconcile-bank', {}),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('payment_request_not_found');

    const day = new Date().toISOString().slice(0, 10);
    const proof = mockRes();
    await router(mockReq('GET', `/v1/payments/daily-totals-proof?day=${day}`), proof.res);
    expect(proof.res.statusCode).toBe(200);
    expect(proof.body().ok).toBe(true);
    expect(proof.body().day).toBe(day);
    expect(Number(proof.body().dayTotal)).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(proof.body().childTotals)).toBe(true);

    const badDay = mockRes();
    await router(mockReq('GET', '/v1/payments/daily-totals-proof?day=not-a-day'), badDay.res);
    expect(badDay.res.statusCode).toBe(400);
    expect(badDay.body().error).toBe('invalid_day');
  });
});
