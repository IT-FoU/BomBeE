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

describe('split shipment HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097228555', 'Split QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('requests, lists, and approves split shipments', async () => {
    const products = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), products.res);
    const product = (
      products.body().products as Array<{
        storeId: string;
        variants: Array<{ id: string }>;
      }>
    )[0]!;

    const cart = mockRes();
    await router(
      mockReq('POST', '/v1/carts', undefined, { authorization: `Bearer ${token}` }),
      cart.res,
    );
    const cartId = cart.body().cartId as string;

    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/items`,
        { storeId: product.storeId, variantId: product.variants[0]!.id, quantity: 2 },
        { authorization: `Bearer ${token}` },
      ),
      mockRes().res,
    );

    const checkout = mockRes();
    await router(
      mockReq('POST', `/v1/carts/${cartId}/checkout`, {}, { authorization: `Bearer ${token}` }),
      checkout.res,
    );
    expect(checkout.res.statusCode).toBe(201);

    const requested = mockRes();
    await router(mockReq('POST', '/v1/ops/orders/split-shipments/mock-request', {}), requested.res);
    expect(requested.res.statusCode).toBe(201);
    const requestId = requested.body().requestId as string;
    const shipmentId = requested.body().shipmentId as string;
    expect(requestId).toBeTruthy();
    expect(shipmentId).toBeTruthy();
    expect(requested.body().status).toBe('pending');

    const list = mockRes();
    await router(mockReq('GET', '/v1/orders/split-shipments'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().requests as Array<{ requestId: string; itemCount: number; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'pending' && r.itemCount >= 1,
      ),
    ).toBe(true);

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/orders/split-shipments/${requestId}/approve`, { shipmentId }),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('approved');

    const again = mockRes();
    await router(
      mockReq('POST', `/v1/ops/orders/split-shipments/${requestId}/approve`, { shipmentId }),
      again.res,
    );
    expect(again.res.statusCode).toBe(409);
    expect(again.body().error).toBe('not_pending');
  });
});
