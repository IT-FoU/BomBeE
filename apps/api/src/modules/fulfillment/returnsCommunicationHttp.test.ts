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
    body: () =>
      JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
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

describe('returns append-communication HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097248067', 'Return Comms QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('appends support notes onto a return and surfaces them on list', async () => {
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

    await router(mockReq('POST', `/v1/ops/orders/${parentId}/confirm-children`, {}), mockRes().res);
    const qr = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/orders/${parentId}/payments/qr`,
        {},
        { authorization: `Bearer ${token}` },
      ),
      qr.res,
    );
    await router(
      mockReq(
        'POST',
        `/v1/payments/${qr.body().paymentRequestId}/mock-confirm`,
        {},
        { authorization: `Bearer ${token}` },
      ),
      mockRes().res,
    );
    await router(
      mockReq('POST', `/v1/ops/orders/${parentId}/fulfillment/mock-advance`, {}),
      mockRes().res,
    );
    await router(
      mockReq('POST', `/v1/ops/orders/${parentId}/fulfillment/mock-deliver`, {}),
      mockRes().res,
    );

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/returns/mock-create', { reason: 'defective' }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const returnRequestId = created.body().returnRequestId as string;

    const noted = mockRes();
    await router(
      mockReq('POST', `/v1/ops/returns/${returnRequestId}/append-communication`, {
        from: 'support',
        text: 'Received evidence',
      }),
      noted.res,
    );
    expect(noted.res.statusCode).toBe(200);
    const notedReturns = noted.body().returns as Array<{
      returnRequestId: string;
      communications: Array<{ text?: string; from?: string }>;
    }>;
    const notedRow = notedReturns.find((r) => r.returnRequestId === returnRequestId);
    expect(notedRow?.communications.some((c) => c.text === 'Received evidence')).toBe(true);

    const list = mockRes();
    await router(mockReq('GET', '/v1/returns'), list.res);
    const listed = (
      list.body().returns as Array<{
        returnRequestId: string;
        communications: Array<{ text?: string }>;
      }>
    ).find((r) => r.returnRequestId === returnRequestId);
    expect(listed?.communications.length).toBeGreaterThanOrEqual(1);

    const missing = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/ops/returns/00000000-0000-0000-0000-000000000000/append-communication',
        { text: 'nope' },
      ),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('return_not_found');

    const bad = mockRes();
    await router(
      mockReq('POST', `/v1/ops/returns/${returnRequestId}/append-communication`, {
        from: 'support',
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('text_required');
  });
});
