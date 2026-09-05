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

describe('privacy HTTP', () => {
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
    const identityId = await services.identity.ensureCustomer('+8562097222001', 'Privacy QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('starts and confirms dual-OTP phone change and lists recovery docs', async () => {
    const identityId = await services.identity.ensureCustomer('+8562097222010', 'Phone Change QA');
    const phoneToken = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });

    const start = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/phone-change/start',
        { newPhone: '+8562097222011' },
        { authorization: `Bearer ${phoneToken}` },
      ),
      start.res,
    );
    expect(start.res.statusCode).toBe(200);
    const correlationId = start.body().correlationId as string;
    const oldCode = start.body().devOldCode as string;
    const newCode = start.body().devNewCode as string;
    expect(correlationId).toBeTruthy();
    expect(oldCode).toMatch(/^\d{6}$/);
    expect(newCode).toMatch(/^\d{6}$/);

    const confirm = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/phone-change/confirm',
        { correlationId, oldCode, newCode },
        { authorization: `Bearer ${phoneToken}` },
      ),
      confirm.res,
    );
    expect(confirm.res.statusCode).toBe(200);
    expect((confirm.body().profile as { phoneE164: string }).phoneE164).toBe('+8562097222011');

    const recovery = mockRes();
    await router(
      mockReq('POST', '/v1/me/recovery-document', {
        claimedPhone: '+8562097222099',
        documentStorageKey: 'private/recovery/qa.pdf',
      }),
      recovery.res,
    );
    expect(recovery.res.statusCode).toBe(201);
    const requestId = recovery.body().requestId as string;

    const list = mockRes();
    await router(mockReq('GET', '/v1/privacy/recovery-requests'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'pending',
      ),
    ).toBe(true);
  });

  it('manages addresses, marketing opt-in, and deletion approve anonymize', async () => {
    const profile = mockRes();
    await router(
      mockReq('GET', '/v1/me/privacy', undefined, { authorization: `Bearer ${token}` }),
      profile.res,
    );
    expect(profile.res.statusCode).toBe(200);
    expect((profile.body().profile as { displayName: string }).displayName).toBeTruthy();

    const addr = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/addresses',
        {
          recipientName: 'Privacy QA',
          recipientPhoneE164: '+8562097222001',
          addressLine: 'Vientiane',
          isDefault: true,
        },
        { authorization: `Bearer ${token}` },
      ),
      addr.res,
    );
    expect(addr.res.statusCode).toBe(201);
    expect((addr.body().addresses as unknown[]).length).toBe(1);

    const opt = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/marketing-opt-in',
        { optIn: false },
        { authorization: `Bearer ${token}` },
      ),
      opt.res,
    );
    expect(opt.res.statusCode).toBe(200);
    expect((opt.body().profile as { marketingOptIn: boolean }).marketingOptIn).toBe(false);

    const del = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/deletion-request',
        { otpVerified: true },
        { authorization: `Bearer ${token}` },
      ),
      del.res,
    );
    expect(del.res.statusCode).toBe(201);
    const requestId = del.body().requestId as string;

    const list = mockRes();
    await router(mockReq('GET', '/v1/privacy/deletion-requests'), list.res);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'pending',
      ),
    ).toBe(true);

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/privacy/deletion-requests/${requestId}/approve`, {}),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('completed');

    const after = mockRes();
    await router(
      mockReq('GET', '/v1/me/privacy', undefined, { authorization: `Bearer ${token}` }),
      after.res,
    );
    expect(after.res.statusCode).toBe(200);
    expect((after.body().profile as { displayName: string }).displayName).toBe('anonymized');
  });

  it('mock-snapshots order address and returns store delivery view', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/privacy/order-address-snapshots'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    const before = (empty.body().snapshots as unknown[]).length;

    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      storeId: string;
      variants: Array<{ id: string }>;
    }>;
    const product = products[0]!;
    const variant = product.variants[0]!;

    const identityId = await services.identity.ensureCustomer('+8562097222055', 'Snapshot QA');
    const snapToken = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });

    const addr = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/addresses',
        {
          recipientName: 'Snapshot QA',
          recipientPhoneE164: '+8562097222055',
          addressLine: 'Ban Phonethan',
          district: 'Xaysettha',
          province: 'Vientiane Capital',
          isDefault: true,
        },
        { authorization: `Bearer ${snapToken}` },
      ),
      addr.res,
    );
    expect(addr.res.statusCode).toBe(201);
    const addressId = addr.body().addressId as string;

    const cartRes = mockRes();
    await router(
      mockReq('POST', '/v1/carts', {}, { authorization: `Bearer ${snapToken}` }),
      cartRes.res,
    );
    const cartId = cartRes.body().cartId as string;
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/items`,
        { storeId: product.storeId, variantId: variant.id, quantity: 1 },
        { authorization: `Bearer ${snapToken}` },
      ),
      mockRes().res,
    );
    const checkoutRes = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/carts/${cartId}/checkout`,
        { shippingLakByStore: { [product.storeId]: 5000 } },
        { authorization: `Bearer ${snapToken}` },
      ),
      checkoutRes.res,
    );
    const parentId = checkoutRes.body().parentId as string;
    expect(parentId).toBeTruthy();

    const noneView = mockRes();
    await router(
      mockReq('GET', `/v1/privacy/orders/${parentId}/store-delivery-view`),
      noneView.res,
    );
    expect(noneView.res.statusCode).toBe(404);
    expect(noneView.body().error).toBe('address_snapshot_missing');

    const snapped = mockRes();
    await router(
      mockReq('POST', '/v1/ops/privacy/order-address-snapshots/mock-snapshot', {
        parent_order_id: parentId,
        address_id: addressId,
      }),
      snapped.res,
    );
    expect(snapped.res.statusCode).toBe(201);
    expect(snapped.body().ok).toBe(true);
    expect(snapped.body().parentOrderId).toBe(parentId);
    expect(
      (
        snapped.body().snapshots as Array<{ parentOrderId: string; addressLine: string }>
      ).some((s) => s.parentOrderId === parentId && s.addressLine === 'Ban Phonethan'),
    ).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/privacy/order-address-snapshots'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect((listed.body().snapshots as unknown[]).length).toBe(before + 1);

    const view = mockRes();
    await router(
      mockReq(
        'GET',
        `/v1/privacy/orders/${parentId}/store-delivery-view?storeId=${product.storeId}`,
      ),
      view.res,
    );
    expect(view.res.statusCode).toBe(200);
    expect(view.body().view).toEqual({
      recipientName: 'Snapshot QA',
      recipientPhone: '+8562097222055',
      addressLine: 'Ban Phonethan',
    });

    const dup = mockRes();
    await router(
      mockReq('POST', '/v1/ops/privacy/order-address-snapshots/mock-snapshot', {
        parent_order_id: parentId,
        address_id: addressId,
      }),
      dup.res,
    );
    expect(dup.res.statusCode).toBe(409);
  });

});
