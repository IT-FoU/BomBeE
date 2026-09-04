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

describe('COD payment HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097225001', 'COD QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('creates COD, reserves stock, advances to delivered with collection', async () => {
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

    const blocked = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/cod`, {}, {
        authorization: `Bearer ${token}`,
      }),
      blocked.res,
    );
    expect(blocked.res.statusCode).toBe(409);

    await router(
      mockReq('POST', `/v1/orders/${parentId}/confirm-children`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockRes().res,
    );

    const cod = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/cod`, {}, {
        authorization: `Bearer ${token}`,
      }),
      cod.res,
    );
    expect(cod.res.statusCode).toBe(201);
    const shipments = cod.body().shipments as Array<{ codShipmentId: string }>;
    expect(shipments.length).toBeGreaterThan(0);
    expect((cod.body().reservations as unknown[]).length).toBeGreaterThan(0);

    const stockReserved = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variant.id}`), stockReserved.res);
    expect(Number(stockReserved.body().availableQty)).toBe(availableBefore - 1);

    const advance = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/fulfillment/mock-advance`, {}, {
        authorization: `Bearer ${token}`,
      }),
      advance.res,
    );
    expect(advance.res.statusCode).toBe(200);
    const advanced = advance.body().children as Array<{ to: string; steps: string[] }>;
    expect(advanced.every((c) => c.to === 'in_transit')).toBe(true);
    expect(advanced[0]!.steps).toContain('consumed:1');

    const deliver = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/fulfillment/mock-deliver`, {}, {
        authorization: `Bearer ${token}`,
      }),
      deliver.res,
    );
    expect(deliver.res.statusCode).toBe(200);
    const delivered = deliver.body().children as Array<{ to: string }>;
    expect(delivered.every((c) => c.to === 'delivered')).toBe(true);

    const paid = await services.db.query<{ payment_received: boolean; status: string }>(
      `SELECT payment_received, status FROM app.child_orders WHERE parent_order_id = $1`,
      [parentId],
    );
    expect(paid.rows.every((r) => r.payment_received && r.status === 'delivered')).toBe(true);
  });
});
