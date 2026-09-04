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

describe('inventory stock import HTTP', () => {
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

  it('previews, commits, and lists stock import batches', async () => {
    const products = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), products.res);
    const variantId = (
      products.body().products as Array<{ variants: Array<{ id: string }> }>
    )[0]!.variants[0]!.id;

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockBefore.res);
    const bal = (
      stockBefore.body().balances as Array<{
        balanceId: string;
        storeId: string;
        lotId: string;
        onHand: number;
      }>
    )[0]!;
    const onHand0 = bal.onHand;

    const previewed = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/import/preview', {
        storeId: bal.storeId,
        idempotencyKey: 'http-stock-1',
        rows: [{ variantId, lotId: bal.lotId, onHand: onHand0 + 7 }],
      }),
      previewed.res,
    );
    expect(previewed.res.statusCode).toBe(201);
    expect(previewed.body().replay).toBe(false);
    expect((previewed.body().report as { differenceTotal: number }).differenceTotal).toBe(7);
    const batchId = previewed.body().batchId as string;

    const replay = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/import/preview', {
        storeId: bal.storeId,
        idempotencyKey: 'http-stock-1',
        rows: [{ variantId, lotId: bal.lotId, onHand: onHand0 + 7 }],
      }),
      replay.res,
    );
    expect(replay.res.statusCode).toBe(201);
    expect(replay.body().replay).toBe(true);
    expect(replay.body().batchId).toBe(batchId);

    const committed = mockRes();
    await router(
      mockReq('POST', `/v1/ops/inventory/import/${batchId}/commit`),
      committed.res,
    );
    expect(committed.res.statusCode).toBe(200);
    expect(committed.body().status).toBe('committed');
    expect(committed.body().replay).toBe(false);

    const stockAfter = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockAfter.res);
    const afterBal = (
      stockAfter.body().balances as Array<{ balanceId: string; onHand: number }>
    ).find((b) => b.balanceId === bal.balanceId);
    expect(afterBal?.onHand).toBe(onHand0 + 7);

    const commitReplay = mockRes();
    await router(
      mockReq('POST', `/v1/ops/inventory/import/${batchId}/commit`),
      commitReplay.res,
    );
    expect(commitReplay.res.statusCode).toBe(200);
    expect(commitReplay.body().replay).toBe(true);

    const list = mockRes();
    await router(mockReq('GET', '/v1/inventory/import/batches'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().batches as Array<{ batchId: string; status: string }>).some(
        (b) => b.batchId === batchId && b.status === 'committed',
      ),
    ).toBe(true);
  });
});
