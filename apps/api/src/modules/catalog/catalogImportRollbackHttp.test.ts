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

describe('catalog import rollback HTTP', () => {
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

  it('rolls back preview batches and rejects rollback of committed batches', async () => {
    const preview = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/import/preview', {
        idempotencyKey: 'http-import-rollback',
        rows: [
          {
            storeProductId: 'HTTP-RB-1',
            sku: 'HTTP-RB-SKU-1',
            titleLo: 'ຍົກເລີກ',
            titleEn: 'Rollback Pack',
            categorySlug: 'general',
            costLak: 1200,
            sellingPriceLak: 2200,
          },
        ],
      }),
      preview.res,
    );
    expect(preview.res.statusCode).toBe(201);
    const batchId = preview.body().batchId as string;

    const rolled = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${batchId}/rollback`, {}),
      rolled.res,
    );
    expect(rolled.res.statusCode).toBe(200);
    expect(rolled.body().status).toBe('rolled_back');
    expect(rolled.body().replay).toBe(false);

    const replay = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${batchId}/rollback`, {}),
      replay.res,
    );
    expect(replay.res.statusCode).toBe(200);
    expect(replay.body().replay).toBe(true);

    const list = mockRes();
    await router(mockReq('GET', '/v1/catalog/import/batches'), list.res);
    expect(
      (list.body().batches as Array<{ batchId: string; status: string }>).some(
        (b) => b.batchId === batchId && b.status === 'rolled_back',
      ),
    ).toBe(true);

    const missing = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/ops/catalog/import/00000000-0000-0000-0000-000000000000/rollback',
        {},
      ),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('batch_not_found');

    const commitPreview = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/import/preview', {
        idempotencyKey: 'http-import-rollback-commit',
        rows: [
          {
            storeProductId: 'HTTP-RB-2',
            sku: 'HTTP-RB-SKU-2',
            titleLo: 'ຄົງທີ່',
            titleEn: 'Keep Pack',
            categorySlug: 'general',
            costLak: 1300,
            sellingPriceLak: 2300,
          },
        ],
      }),
      commitPreview.res,
    );
    const commitBatchId = commitPreview.body().batchId as string;
    const committed = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${commitBatchId}/commit`, {}),
      committed.res,
    );
    expect(committed.res.statusCode).toBe(200);

    const blocked = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/import/${commitBatchId}/rollback`, {}),
      blocked.res,
    );
    expect(blocked.res.statusCode).toBe(409);
    expect(blocked.body().error).toBe('cannot_rollback_committed');
  });
});
