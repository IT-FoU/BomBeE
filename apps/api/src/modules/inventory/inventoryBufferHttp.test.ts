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

describe('inventory reconcile + safety buffer HTTP', () => {
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

  it('reconciles ledger and updates safety buffer on existing balances', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    expect(productsRes.res.statusCode).toBe(200);
    const products = productsRes.body().products as Array<{
      variants: Array<{ id: string }>;
      availableQty: number;
    }>;
    const variantId = products[0]!.variants[0]!.id;
    const availableBefore = products[0]!.availableQty;

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockBefore.res);
    expect(stockBefore.res.statusCode).toBe(200);
    const balances = stockBefore.body().balances as Array<{
      balanceId: string;
      storeId: string;
      available: number;
      safetyBuffer: number;
    }>;
    expect(balances.length).toBeGreaterThan(0);
    const balanceId = balances[0]!.balanceId;
    const storeId = balances[0]!.storeId;

    const reconcile = mockRes();
    await router(mockReq('GET', `/v1/inventory/balances/${balanceId}/reconcile`), reconcile.res);
    expect(reconcile.res.statusCode).toBe(200);
    expect(reconcile.body().difference).toBe(0);
    expect(reconcile.body().balanceId).toBe(balanceId);

    const missing = mockRes();
    await router(
      mockReq('GET', '/v1/inventory/balances/00000000-0000-0000-0000-000000000000/reconcile'),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('balance_not_found');

    const buffer = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/safety-buffer', {
        balanceId,
        safetyBuffer: 3,
      }),
      buffer.res,
    );
    expect(buffer.res.statusCode).toBe(200);
    expect(buffer.body().safetyBuffer).toBe(3);
    expect(Number(buffer.body().balancesUpdated)).toBeGreaterThanOrEqual(1);
    const stock = buffer.body().stock as {
      availableQty: number;
      balances: Array<{ safetyBuffer: number; available: number }>;
    };
    expect(stock.balances[0]!.safetyBuffer).toBe(3);
    expect(stock.availableQty).toBeLessThan(availableBefore);

    const byIds = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/safety-buffer', {
        storeId,
        variantId,
        safetyBuffer: 0,
      }),
      byIds.res,
    );
    expect(byIds.res.statusCode).toBe(200);
    expect(byIds.body().safetyBuffer).toBe(0);

    const bad = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/safety-buffer', {
        balanceId,
        safetyBuffer: -1,
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('invalid_safety_buffer');
  });
});
