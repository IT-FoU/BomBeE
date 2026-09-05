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

describe('delivery list + mock-create HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097248060', 'Delivery QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists empty then mock-creates a delivery for a confirmed child', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/deliveries'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().deliveries).toEqual([]);

    const none = mockRes();
    await router(mockReq('POST', '/v1/ops/deliveries/mock-create', {}), none.res);
    expect(none.res.statusCode).toBe(409);
    expect(none.body().error).toBe('no_eligible_child');

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
      mockReq('POST', `/v1/ops/orders/${parentId}/confirm-children`, {}),
      mockRes().res,
    );

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/deliveries/mock-create', {
        channel: 'manual',
        courier_code: 'LOCAL-MOCK',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(created.body().ok).toBe(true);
    expect(created.body().deliveryId).toBeTruthy();
    expect(created.body().trackingNumber).toBeTruthy();
    expect(created.body().channel).toBe('manual');
    const childOrderId = created.body().childOrderId as string;
    expect(childOrderId).toBeTruthy();
    expect(
      (
        created.body().deliveries as Array<{
          deliveryId: string;
          childOrderId: string;
          courierCode: string;
          status: string;
        }>
      ).some(
        (d) =>
          d.deliveryId === created.body().deliveryId &&
          d.childOrderId === childOrderId &&
          d.courierCode === 'LOCAL-MOCK' &&
          d.status === 'created',
      ),
    ).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/deliveries'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect(
      (listed.body().deliveries as Array<{ deliveryId: string }>).some(
        (d) => d.deliveryId === created.body().deliveryId,
      ),
    ).toBe(true);
  });

  it('mock-handoffs then records POD on a created delivery', async () => {
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
      mockReq('POST', `/v1/ops/orders/${parentId}/confirm-children`, {}),
      mockRes().res,
    );

    const created = mockRes();
    await router(mockReq('POST', '/v1/ops/deliveries/mock-create', {}), created.res);
    expect(created.res.statusCode).toBe(201);
    const deliveryId = created.body().deliveryId as string;

    const nonePod = mockRes();
    await router(mockReq('POST', '/v1/ops/deliveries/mock-record-pod', {}), nonePod.res);
    expect(nonePod.res.statusCode).toBe(409);
    expect(nonePod.body().error).toBe('no_eligible_delivery');

    const handed = mockRes();
    await router(
      mockReq('POST', '/v1/ops/deliveries/mock-handoff', { delivery_id: deliveryId }),
      handed.res,
    );
    expect(handed.res.statusCode).toBe(200);
    expect(handed.body().ok).toBe(true);
    expect(handed.body().deliveryId).toBe(deliveryId);
    expect(
      (
        handed.body().deliveries as Array<{ deliveryId: string; status: string }>
      ).some((d) => d.deliveryId === deliveryId && d.status === 'handed_off'),
    ).toBe(true);

    const pod = mockRes();
    await router(
      mockReq('POST', '/v1/ops/deliveries/mock-record-pod', {
        delivery_id: deliveryId,
        pod_method: 'signature',
      }),
      pod.res,
    );
    expect(pod.res.statusCode).toBe(200);
    expect(pod.body().ok).toBe(true);
    expect(pod.body().podMethod).toBe('signature');
    expect(
      (
        pod.body().deliveries as Array<{ deliveryId: string; status: string }>
      ).some((d) => d.deliveryId === deliveryId && d.status === 'delivered'),
    ).toBe(true);
  });

});
