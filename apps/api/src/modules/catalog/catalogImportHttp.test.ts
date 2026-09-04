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

describe('catalog import HTTP', () => {
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

  it('previews, rejects invalid batches, and commits valid imports', async () => {
    const bad = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/import/preview', {
        idempotencyKey: 'http-import-bad',
        rows: [
          {
            storeProductId: 'HTTP-IMP-1',
            sku: 'HTTP-SKU-1',
            titleLo: 'ດີ',
            titleEn: 'Good',
            categorySlug: 'general',
            costLak: 1000,
            sellingPriceLak: 2000,
          },
          {
            storeProductId: 'HTTP-IMP-BAD',
            sku: 'HTTP-SKU-BAD',
            titleLo: 'ເຫຼົ້າ',
            titleEn: 'Alcohol',
            categorySlug: 'alcohol',
            costLak: 1000,
            sellingPriceLak: 2000,
          },
        ],
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(201);
    const badBatchId = bad.body().batchId as string;
    expect((bad.body().report as { invalid: number }).invalid).toBe(1);

    const reject = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${badBatchId}/commit`, {}),
      reject.res,
    );
    expect(reject.res.statusCode).toBe(409);
    expect(reject.body().error).toBe('invalid_rows');

    const good = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/import/preview', {
        idempotencyKey: 'http-import-good',
        rows: [
          {
            storeProductId: 'HTTP-IMP-OK',
            sku: 'HTTP-SKU-OK',
            titleLo: 'ນ້ຳ',
            titleEn: 'Water Pack',
            categorySlug: 'general',
            costLak: 1500,
            sellingPriceLak: 2500,
          },
        ],
      }),
      good.res,
    );
    expect(good.res.statusCode).toBe(201);
    const goodBatchId = good.body().batchId as string;

    const committed = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${goodBatchId}/commit`, {}),
      committed.res,
    );
    expect(committed.res.statusCode).toBe(200);
    expect(committed.body().status).toBe('committed');

    const list = mockRes();
    await router(mockReq('GET', '/v1/catalog/import/batches'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().batches as Array<{ batchId: string; status: string }>).some(
        (b) => b.batchId === goodBatchId && b.status === 'committed',
      ),
    ).toBe(true);
  });
});
