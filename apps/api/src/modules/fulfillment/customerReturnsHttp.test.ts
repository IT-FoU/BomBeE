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

describe('customer returns HTTP', () => {
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
  let otherToken: string;

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
    const identityId = await services.identity.ensureCustomer('+8562097222060', 'Return Me QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
    const otherId = await services.identity.ensureCustomer('+8562097222061', 'Other Return');
    otherToken = await services.identity.createSession({
      authIdentityId: otherId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('creates and lists own returns after delivery', async () => {
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

    const children = await services.db.query<{ id: string }>(
      `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
      [parentId],
    );
    const childOrderId = children.rows[0]!.id;

    const created = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/returns',
        { childOrderId, reason: 'defective' },
        { authorization: `Bearer ${token}` },
      ),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const returnRequestId = created.body().returnRequestId as string;
    expect(returnRequestId).toBeTruthy();

    const list = mockRes();
    await router(
      mockReq('GET', '/v1/me/returns', undefined, { authorization: `Bearer ${token}` }),
      list.res,
    );
    expect(
      (list.body().returns as Array<{ returnRequestId: string }>).some(
        (r) => r.returnRequestId === returnRequestId,
      ),
    ).toBe(true);

    const forbidden = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/returns',
        { childOrderId, reason: 'wrong_item' },
        { authorization: `Bearer ${otherToken}` },
      ),
      forbidden.res,
    );
    expect(forbidden.res.statusCode).toBe(403);
  });
});
