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

describe('inventory HTTP stock + receive/adjust', () => {
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

  it('seeds stock and exposes available qty on catalog + stock endpoint', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    expect(productsRes.res.statusCode).toBe(200);
    const products = productsRes.body().products as Array<{
      availableQty: number;
      variants: Array<{ id: string }>;
    }>;
    expect(products.length).toBeGreaterThanOrEqual(3);
    expect(products.every((p) => p.availableQty > 0)).toBe(true);

    const variantId = products[0]!.variants[0]!.id;
    const stockRes = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockRes.res);
    expect(stockRes.res.statusCode).toBe(200);
    expect(Number(stockRes.body().availableQty)).toBeGreaterThan(0);
    expect((stockRes.body().balances as unknown[]).length).toBeGreaterThan(0);
  });

  it('receives stock, adjusts with maker-checker, and lists adjustments', async () => {
    const productsRes = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), productsRes.res);
    const products = productsRes.body().products as Array<{
      variants: Array<{ id: string }>;
    }>;
    const variantId = products[0]!.variants[0]!.id;

    const stockBefore = mockRes();
    await router(mockReq('GET', `/v1/inventory/stock?variantId=${variantId}`), stockBefore.res);
    const balances = stockBefore.body().balances as Array<{
      balanceId: string;
      onHand: number;
    }>;
    const balanceId = balances[0]!.balanceId;
    const onHand0 = balances[0]!.onHand;

    const received = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/receive', { balanceId, quantity: 3 }),
      received.res,
    );
    expect(received.res.statusCode).toBe(201);
    expect(Number(received.body().onHand)).toBe(onHand0 + 3);

    const adjusted = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/adjust', {
        balanceId,
        delta: -1,
        reason: 'local mock cycle count',
      }),
      adjusted.res,
    );
    expect(adjusted.res.statusCode).toBe(200);
    expect(adjusted.body().status).toBe('approved');
    expect(Number(adjusted.body().onHand)).toBe(onHand0 + 2);

    const list = mockRes();
    await router(mockReq('GET', '/v1/inventory/adjustments'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().adjustments as Array<{ balanceId: string; delta: number; status: string }>).some(
        (a) => a.balanceId === balanceId && a.delta === -1 && a.status === 'approved',
      ),
    ).toBe(true);

    const denied = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/adjust', {
        balanceId,
        delta: -(onHand0 + 1000),
        reason: 'local mock overshoot adjust',
      }),
      denied.res,
    );
    expect(denied.res.statusCode).toBe(409);
    expect(denied.body().error).toBe('insufficient_stock');
  });
});
