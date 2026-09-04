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

describe('checkout HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097111001', 'Checkout QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('creates cart, checks out seeded product, and returns order view', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      storeId: string;
      variants: Array<{ id: string }>;
    }>;
    expect(products.length).toBeGreaterThan(0);
    const product = products[0]!;
    const variant = product.variants[0]!;

    const cartRes = mockRes();
    await router(
      mockReq('POST', '/v1/carts', {}, { authorization: `Bearer ${token}` }),
      cartRes.res,
    );
    expect(cartRes.res.statusCode).toBe(201);
    const cartId = cartRes.body().cartId as string;

    const itemRes = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/items`,
        { storeId: product.storeId, variantId: variant.id, quantity: 2 },
        { authorization: `Bearer ${token}` },
      ),
      itemRes.res,
    );
    expect(itemRes.res.statusCode).toBe(200);

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
    expect(parentId).toBeTruthy();

    const orderRes = mockRes();
    await router(
      mockReq('GET', `/v1/orders/${parentId}`, undefined, {
        authorization: `Bearer ${token}`,
      }),
      orderRes.res,
    );
    expect(orderRes.res.statusCode).toBe(200);
    expect((orderRes.body().combined as { status: string }).status).toBe('pending_supplier');
  });

  it('applies LOCAL10 promo code at checkout', async () => {
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
        { storeId: product.storeId, variantId: variant.id, quantity: 2 },
        { authorization: `Bearer ${token}` },
      ),
      mockRes().res,
    );

    const checkoutRes = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/checkout`,
        { shippingLakByStore: { [product.storeId]: 0 }, promoCode: 'LOCAL10' },
        { authorization: `Bearer ${token}` },
      ),
      checkoutRes.res,
    );
    expect(checkoutRes.res.statusCode).toBe(201);
    const promo = checkoutRes.body().promo as {
      code: string;
      percentOff: number;
      discountLak: number;
    };
    expect(promo.code).toBe('LOCAL10');
    expect(promo.percentOff).toBe(10);
    expect(promo.discountLak).toBeGreaterThan(0);

    const parentId = checkoutRes.body().parentId as string;
    const orderRes = mockRes();
    await router(
      mockReq('GET', `/v1/orders/${parentId}`, undefined, {
        authorization: `Bearer ${token}`,
      }),
      orderRes.res,
    );
    const combined = orderRes.body().combined as { discount_lak: number | string };
    expect(Number(combined.discount_lak)).toBe(promo.discountLak);
  });

  it('rejects cart create without bearer', async () => {
    const res = mockRes();
    await router(mockReq('POST', '/v1/carts'), res.res);
    expect(res.res.statusCode).toBe(401);
  });
});
