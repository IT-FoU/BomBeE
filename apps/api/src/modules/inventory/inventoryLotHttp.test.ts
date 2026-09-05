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

describe('inventory lot mock-create HTTP', () => {
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

  it('mock-creates a lot + balance and returns stock for the variant', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    expect(productsRes.res.statusCode).toBe(200);
    const products = productsRes.body().products as Array<{
      variants: Array<{ id: string }>;
    }>;
    const variantId = products[0]!.variants[0]!.id;

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockBefore.res);
    expect(stockBefore.res.statusCode).toBe(200);
    const balancesBefore = stockBefore.body().balances as Array<{ balanceId: string }>;
    const beforeCount = balancesBefore.length;

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/lots/mock-create', {
        variantId,
        lotCode: 'LOT-QA-72',
        categorySlug: 'general',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(created.body().lotId).toBeTruthy();
    expect(created.body().balanceId).toBeTruthy();
    expect(created.body().lotCode).toBe('LOT-QA-72');
    expect(created.body().variantId).toBe(variantId);

    const stock = created.body().stock as {
      variantId: string;
      balances: Array<{ lotCode: string | null; balanceId: string }>;
    };
    expect(stock.variantId).toBe(variantId);
    expect(stock.balances.length).toBe(beforeCount + 1);
    expect(stock.balances.some((b) => b.lotCode === 'LOT-QA-72')).toBe(true);

    const stockAfter = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockAfter.res);
    expect(stockAfter.res.statusCode).toBe(200);
    const balancesAfter = stockAfter.body().balances as Array<{ lotCode: string | null }>;
    expect(balancesAfter.some((b) => b.lotCode === 'LOT-QA-72')).toBe(true);
  });

  it('rejects food category lots missing production/expiry dates', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      variants: Array<{ id: string }>;
    }>;
    const variantId = products[0]!.variants[0]!.id;

    const missing = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/lots/mock-create', {
        variantId,
        lotCode: 'LOT-FOOD-MISSING',
        categorySlug: 'food',
      }),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(400);
    expect(missing.body().error).toBe('lot_fields_required');
  });
});
