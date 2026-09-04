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

describe('refunds HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097259001', 'Refund QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('creates, approves, and pays a refund after delivery', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/refunds'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().refunds).toEqual([]);

    const none = mockRes();
    await router(mockReq('POST', '/v1/ops/refunds/mock-create', {}), none.res);
    expect(none.res.statusCode).toBe(409);
    expect(none.body().error).toBe('no_eligible_child_for_refund');

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
      mockReq('POST', `/v1/orders/${parentId}/payments/qr`, {}, {
        authorization: `Bearer ${token}`,
      }),
      qr.res,
    );
    await router(
      mockReq('POST', `/v1/payments/${qr.body().paymentRequestId}/mock-confirm`, {}, {
        authorization: `Bearer ${token}`,
      }),
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
    await router(mockReq('POST', '/v1/ops/refunds/mock-create', {}), created.res);
    expect(created.res.statusCode).toBe(201);
    const approvalId = created.body().approvalId as string;
    expect(approvalId).toBeTruthy();

    const approve = mockRes();
    await router(mockReq('POST', `/v1/ops/refunds/${approvalId}/approve`, {}), approve.res);
    expect(approve.res.statusCode).toBe(200);
    expect(approve.body().status).toBe('approved');
    expect(approve.body().slaDueAt).toBeTruthy();

    const pay = mockRes();
    await router(mockReq('POST', `/v1/ops/refunds/${approvalId}/mock-pay`, {}), pay.res);
    expect(pay.res.statusCode).toBe(200);
    expect(pay.body().status).toBe('paid');

    const list = mockRes();
    await router(mockReq('GET', '/v1/refunds'), list.res);
    const refunds = list.body().refunds as Array<{ approvalId: string; status: string }>;
    expect(refunds.some((r) => r.approvalId === approvalId && r.status === 'paid')).toBe(true);
  });
});
