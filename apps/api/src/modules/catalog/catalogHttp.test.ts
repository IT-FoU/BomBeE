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

function mockReq(method: string, url: string): IncomingMessage {
  const stream = {
    method,
    url,
    headers: { host: 'localhost' },
    async *[Symbol.asyncIterator]() {},
  };
  return stream as unknown as IncomingMessage;
}

describe('catalog HTTP browse', () => {
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

  it('lists seeded active products and categories', async () => {
    const cats = mockRes();
    await router(mockReq('GET', '/v1/catalog/categories'), cats.res);
    expect(cats.res.statusCode).toBe(200);
    const categories = cats.body().categories as Array<{ slug: string }>;
    expect(categories.some((c) => c.slug === 'food')).toBe(true);

    const products = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), products.res);
    expect(products.res.statusCode).toBe(200);
    const rows = products.body().products as Array<{
      titleEn: string;
      priceLak: number;
      variants: Array<{ sku: string }>;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((p) => p.titleEn.includes('Water'))).toBe(true);
    expect(rows[0]!.variants.length).toBeGreaterThan(0);
    expect(rows[0]!.priceLak).toBeGreaterThan(0);
  });
});
