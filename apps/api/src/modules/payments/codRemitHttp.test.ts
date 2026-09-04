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

describe('COD remittance HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097227001', 'Remit QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists COD shipments and mock-remits balance due with reconcile', async () => {
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
    const cod = mockRes();
    await router(
      mockReq('POST', `/v1/orders/${parentId}/payments/cod`, {}, {
        authorization: `Bearer ${token}`,
      }),
      cod.res,
    );
    expect(cod.res.statusCode).toBe(201);
    const shipment = (cod.body().shipments as Array<{
      codShipmentId: string;
      balanceDueLak: number;
    }>)[0]!;

    await router(
      mockReq('POST', `/v1/orders/${parentId}/fulfillment/mock-advance`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockRes().res,
    );
    await router(
      mockReq('POST', `/v1/orders/${parentId}/fulfillment/mock-deliver`, {}, {
        authorization: `Bearer ${token}`,
      }),
      mockRes().res,
    );

    const list = mockRes();
    await router(mockReq('GET', '/v1/cod/shipments'), list.res);
    expect(list.res.statusCode).toBe(200);
    const listed = list.body().shipments as Array<{ codShipmentId: string; status: string }>;
    expect(listed.some((s) => s.codShipmentId === shipment.codShipmentId)).toBe(true);
    expect(listed.find((s) => s.codShipmentId === shipment.codShipmentId)?.status).toBe('collected');

    const remit = mockRes();
    await router(
      mockReq('POST', `/v1/cod/shipments/${shipment.codShipmentId}/mock-remit`, {
        courierRef: 'MOCK-COURIER-1',
      }),
      remit.res,
    );
    expect(remit.res.statusCode).toBe(200);
    expect(remit.body().status).toBe('remitted');
    expect(remit.body().amountLak).toBe(shipment.balanceDueLak);
    expect((remit.body().reconcile as { difference: number }).difference).toBe(0);

    const child = await services.db.query<{ status: string }>(
      `SELECT status FROM app.child_orders WHERE parent_order_id = $1`,
      [parentId],
    );
    expect(child.rows[0]?.status).toBe('delivered');

    const again = mockRes();
    await router(
      mockReq('POST', `/v1/cod/shipments/${shipment.codShipmentId}/mock-remit`, {}),
      again.res,
    );
    expect(again.res.statusCode).toBe(200);
    expect(again.body().idempotentReplay).toBe(true);
  });
});
