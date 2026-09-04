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

describe('delivery claims HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097248058', 'Claims QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists, opens, and resolves a delivery claim after mock deliver', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/delivery-claims'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().claims).toEqual([]);

    const none = mockRes();
    await router(mockReq('POST', '/v1/ops/delivery-claims/mock-open', {}), none.res);
    expect(none.res.statusCode).toBe(409);
    expect(none.body().error).toBe('no_eligible_delivery');

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

    const opened = mockRes();
    await router(
      mockReq('POST', '/v1/ops/delivery-claims/mock-open', {
        claim_type: 'damaged',
        notes: 'box crushed',
      }),
      opened.res,
    );
    expect(opened.res.statusCode).toBe(201);
    const claimId = opened.body().claimId as string;
    expect(claimId).toBeTruthy();
    expect(opened.body().liabilityParty).toBe('courier');
    expect(opened.body().status).toBe('platform_coordinating');
    expect(
      (opened.body().claims as Array<{ claimId: string; deliveryStatus: string }>).some(
        (c) => c.claimId === claimId && c.deliveryStatus === 'claim_open',
      ),
    ).toBe(true);

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/delivery-claims/mock-open', {
        delivery_id: opened.body().deliveryId,
      }),
      again.res,
    );
    expect(again.res.statusCode).toBe(409);
    expect(again.body().error).toBe('claim_already_open');

    const resolved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/delivery-claims/${claimId}/resolve`, {
        status: 'resolved',
        notes: 'courier credited',
      }),
      resolved.res,
    );
    expect(resolved.res.statusCode).toBe(200);
    expect(resolved.body().status).toBe('resolved');
    expect(
      (resolved.body().claims as Array<{ claimId: string; status: string; deliveryStatus: string }>).some(
        (c) =>
          c.claimId === claimId && c.status === 'resolved' && c.deliveryStatus === 'delivered',
      ),
    ).toBe(true);

    const second = mockRes();
    await router(
      mockReq('POST', `/v1/ops/delivery-claims/${claimId}/resolve`, { status: 'rejected' }),
      second.res,
    );
    expect(second.res.statusCode).toBe(409);
    expect(second.body().error).toBe('claim_not_open');
  });
});
