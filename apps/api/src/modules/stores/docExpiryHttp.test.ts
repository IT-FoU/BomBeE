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

describe('document expiry HTTP', () => {
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

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists alerts and suspends store when verified docs expire', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/stores/document-expiry-alerts'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(Array.isArray(empty.body().alerts)).toBe(true);

    const evaluated = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/documents/mock-evaluate-expiry', {
        today: '2026-09-04',
        expires_at: '2026-09-01',
      }),
      evaluated.res,
    );
    expect(evaluated.res.statusCode).toBe(200);
    expect(evaluated.body().storeStatus).toBe('suspended');
    expect(evaluated.body().canAcceptOrders).toBe(false);
    const storeId = evaluated.body().storeId as string;
    expect(
      (evaluated.body().suspendedStoreIds as string[]).includes(storeId),
    ).toBe(true);
    expect(
      (
        evaluated.body().alerts as Array<{
          storeId: string;
          sentAt: string | null;
          expiresAt: string | null;
        }>
      ).some((a) => a.storeId === storeId && Boolean(a.sentAt) && a.expiresAt === '2026-09-01'),
    ).toBe(true);

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/documents/mock-evaluate-expiry', {
        store_id: storeId,
        today: '2026-09-05',
        expires_at: '2026-09-01',
      }),
      again.res,
    );
    expect(again.res.statusCode).toBe(200);
    expect(again.body().storeStatus).toBe('suspended');

    const expired = mockRes();
    await router(mockReq('GET', '/v1/stores/document-expiry-alerts?filter=expired'), expired.res);
    expect(expired.res.statusCode).toBe(200);
    expect(
      (expired.body().alerts as Array<{ storeId: string }>).some((a) => a.storeId === storeId),
    ).toBe(true);
  });

  it('directly suspends a store for expired documents via ops mock', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/stores', {
        code: `DS${Date.now().toString().slice(-6)}`,
        name: 'Direct Suspend Mart',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const storeId = (created.body().store as { id: string }).id;
    expect(storeId).toBeTruthy();

    await services.db.query(
      `UPDATE app.stores
       SET status = 'active', can_accept_orders = true, products_visible = true
       WHERE id = $1`,
      [storeId],
    );

    const suspended = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/documents/mock-suspend-expired', { store_id: storeId }),
      suspended.res,
    );
    expect(suspended.res.statusCode).toBe(200);
    expect(suspended.body().storeId).toBe(storeId);
    expect(suspended.body().storeStatus).toBe('suspended');
    expect(suspended.body().canAcceptOrders).toBe(false);
    expect(suspended.body().productsVisible).toBe(true);
    expect(suspended.body().existingOrdersUnderReview).toBe(true);
    expect(
      (suspended.body().suspension as { reasonCode: string; active: boolean } | undefined)
        ?.reasonCode,
    ).toBe('document_expired');
    expect(
      (suspended.body().suspension as { active: boolean } | undefined)?.active,
    ).toBe(true);
    expect(
      (
        suspended.body().suspensions as Array<{
          storeId: string;
          reasonCode: string;
          active: boolean;
        }>
      ).some(
        (s) => s.storeId === storeId && s.reasonCode === 'document_expired' && s.active,
      ),
    ).toBe(true);
  });
});
