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

describe('settlement HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097235001', 'Settle QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists empty then creates draft batch after QR deliver', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/settlements'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().batches).toEqual([]);

    const none = mockRes();
    await router(mockReq('POST', '/v1/ops/settlements/mock-create', {}), none.res);
    expect(none.res.statusCode).toBe(409);
    expect(none.body().error).toBe('no_eligible_orders');

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
    expect(qr.res.statusCode).toBe(201);
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
    await router(
      mockReq('POST', '/v1/ops/settlements/mock-create', { store_id: product.storeId }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(Number(created.body().lineCount)).toBeGreaterThanOrEqual(1);
    expect(created.body().batchId).toBeTruthy();

    const list = mockRes();
    await router(mockReq('GET', '/v1/settlements'), list.res);
    expect(list.res.statusCode).toBe(200);
    const batches = list.body().batches as Array<{ batchId: string; status: string; lineCount: number }>;
    expect(batches.some((b) => b.batchId === created.body().batchId && b.status === 'draft')).toBe(
      true,
    );

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/settlements/mock-create', { store_id: product.storeId }),
      again.res,
    );
    expect(again.res.statusCode).toBe(409);
    expect(again.body().error).toBe('no_eligible_orders');

    const batchId = created.body().batchId as string;
    const lines = mockRes();
    await router(mockReq('GET', `/v1/settlements/${batchId}/lines`), lines.res);
    expect(lines.res.statusCode).toBe(200);
    expect((lines.body().lines as unknown[]).length).toBeGreaterThanOrEqual(1);

    const submit = mockRes();
    await router(mockReq('POST', `/v1/ops/settlements/${batchId}/submit`, {}), submit.res);
    expect(submit.res.statusCode).toBe(200);
    expect(submit.body().status).toBe('pending_approval');

    const submitAgain = mockRes();
    await router(mockReq('POST', `/v1/ops/settlements/${batchId}/submit`, {}), submitAgain.res);
    expect(submitAgain.res.statusCode).toBe(409);
    expect(submitAgain.body().error).toBe('batch_not_submittable');

    const approve = mockRes();
    await router(mockReq('POST', `/v1/ops/settlements/${batchId}/approve`, {}), approve.res);
    expect(approve.res.statusCode).toBe(200);
    expect(approve.body().status).toBe('approved');

    const dispute = mockRes();
    await router(
      mockReq('POST', `/v1/ops/settlements/${batchId}/dispute`, {
        reason: 'qa fee mismatch',
      }),
      dispute.res,
    );
    expect(dispute.res.statusCode).toBe(200);
    expect(dispute.body().status).toBe('partially_disputed');
    expect(dispute.body().disputeId).toBeTruthy();
  });

  it('holds a settlement line and records negative carryforward', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      storeId: string;
      variants: Array<{ id: string }>;
    }>;
    const product = products[1] ?? products[0]!;
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
      mockReq('POST', '/v1/ops/settlements/mock-create', { store_id: product.storeId }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const batchId = created.body().batchId as string;
    const heldBefore = Number(created.body().heldLak ?? 0);
    const netBefore = Number(created.body().netLak);

    const held = mockRes();
    await router(mockReq('POST', `/v1/ops/settlements/${batchId}/hold-line`, {}), held.res);
    expect(held.res.statusCode).toBe(200);
    expect(held.body().held).toBe(true);
    expect(
      (held.body().lines as Array<{ held: boolean }>).some((l) => l.held),
    ).toBe(true);
    const heldBatch = (
      held.body().batches as Array<{ batchId: string; heldLak: number; netLak: number }>
    ).find((b) => b.batchId === batchId);
    expect(Number(heldBatch?.heldLak)).toBeGreaterThan(heldBefore);
    expect(Number(heldBatch?.netLak)).toBeLessThan(netBefore);

    const carry = mockRes();
    await router(
      mockReq('POST', '/v1/ops/settlements/mock-carryforward', {
        store_id: product.storeId,
        amount_lak: -25000,
        source_batch_id: batchId,
        collect: true,
      }),
      carry.res,
    );
    expect(carry.res.statusCode).toBe(201);
    expect(carry.body().carryforwardId).toBeTruthy();
    expect(carry.body().collectionRequestId).toBeTruthy();

    const list = mockRes();
    await router(mockReq('GET', '/v1/settlements/carryforwards'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (
        list.body().carryforwards as Array<{
          carryforwardId: string;
          amountLak: number;
          status: string;
          collectionRequestId: string | null;
        }>
      ).some(
        (c) =>
          c.carryforwardId === carry.body().carryforwardId &&
          c.amountLak === -25000 &&
          c.status === 'open' &&
          Boolean(c.collectionRequestId),
      ),
    ).toBe(true);

    const bad = mockRes();
    await router(
      mockReq('POST', '/v1/ops/settlements/mock-carryforward', {
        store_id: product.storeId,
        amount_lak: 100,
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('carryforward_must_be_negative');
  });
});
