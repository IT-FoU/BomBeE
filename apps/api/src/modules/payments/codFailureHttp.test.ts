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

describe('COD failure / restore / redelivery fee HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097248061', 'COD Fail QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('forces QR after two customer-caused failures, restores, and records redelivery fee', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/cod/profiles'), empty.res);
    expect(empty.res.statusCode).toBe(200);

    const skipped = mockRes();
    await router(
      mockReq('POST', '/v1/ops/cod/profiles/mock-failure', { customer_caused: false }),
      skipped.res,
    );
    expect(skipped.res.statusCode).toBe(200);
    expect(skipped.body().skipped).toBe(true);
    expect(skipped.body().qrForced).toBe(false);

    const first = mockRes();
    await router(mockReq('POST', '/v1/ops/cod/profiles/mock-failure', {}), first.res);
    expect(first.res.statusCode).toBe(200);
    const customerIdentityId = first.body().customerIdentityId as string;
    expect(customerIdentityId).toBeTruthy();
    expect(first.body().failedCodCount).toBe(1);
    expect(first.body().qrForced).toBe(false);

    const second = mockRes();
    await router(
      mockReq('POST', '/v1/ops/cod/profiles/mock-failure', {
        customer_identity_id: customerIdentityId,
      }),
      second.res,
    );
    expect(second.res.statusCode).toBe(200);
    expect(second.body().failedCodCount).toBe(2);
    expect(second.body().qrForced).toBe(true);
    expect(
      (
        second.body().profiles as Array<{ customerIdentityId: string; qrForced: boolean }>
      ).some((p) => p.customerIdentityId === customerIdentityId && p.qrForced),
    ).toBe(true);

    const restored = mockRes();
    await router(
      mockReq('POST', `/v1/ops/cod/profiles/${customerIdentityId}/restore`, {
        reason: 'qa restore',
      }),
      restored.res,
    );
    expect(restored.res.statusCode).toBe(200);
    expect(restored.body().qrForced).toBe(false);
    expect(
      (
        restored.body().profiles as Array<{
          customerIdentityId: string;
          qrForced: boolean;
          failedCodCount: number;
        }>
      ).some(
        (p) =>
          p.customerIdentityId === customerIdentityId &&
          !p.qrForced &&
          p.failedCodCount === 0,
      ),
    ).toBe(true);

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

    const fee = mockRes();
    await router(
      mockReq('POST', '/v1/ops/cod/redelivery-fees/mock-require', { amount_lak: 15000 }),
      fee.res,
    );
    expect(fee.res.statusCode).toBe(201);
    expect(fee.body().amountLak).toBe(15000);
    expect(fee.body().redeliveryFeeId).toBeTruthy();

    const fees = mockRes();
    await router(mockReq('GET', '/v1/cod/redelivery-fees'), fees.res);
    expect(fees.res.statusCode).toBe(200);
    expect(
      (fees.body().fees as Array<{ redeliveryFeeId: string }>).some(
        (f) => f.redeliveryFeeId === fee.body().redeliveryFeeId,
      ),
    ).toBe(true);
  });
});
