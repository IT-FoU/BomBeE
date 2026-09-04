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

describe('catalog status HTTP', () => {
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

  it('activates imported draft product+variant and pauses from storefront list', async () => {
    const preview = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/import/preview', {
        idempotencyKey: 'status-http-import',
        rows: [
          {
            storeProductId: 'STATUS-IMP-1',
            sku: 'STATUS-SKU-1',
            titleLo: 'ສະຖານະ',
            titleEn: 'Status Pack',
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

    const commit = mockRes();
    await router(mockReq('POST', `/v1/ops/catalog/import/${batchId}/commit`, {}), commit.res);
    expect(commit.res.statusCode).toBe(200);

    const drafts = mockRes();
    await router(mockReq('GET', '/v1/ops/catalog/products?status=draft'), drafts.res);
    expect(drafts.res.statusCode).toBe(200);
    const draftProduct = (
      drafts.body().products as Array<{
        id: string;
        slug: string;
        status: string;
        variants: Array<{ id: string; status: string }>;
      }>
    ).find((p) => p.slug === 'STATUS-IMP-1');
    expect(draftProduct?.status).toBe('draft');
    expect(draftProduct?.variants[0]?.status).toBe('draft');

    const activeBefore = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), activeBefore.res);
    expect(
      (
        activeBefore.body().products as Array<{ slug: string }>
      ).some((p) => p.slug === 'STATUS-IMP-1'),
    ).toBe(false);

    const productActive = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/products/${draftProduct!.id}/status`, {
        status: 'active',
      }),
      productActive.res,
    );
    expect(productActive.res.statusCode).toBe(200);
    expect(productActive.body().status).toBe('active');

    const variantActive = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/variants/${draftProduct!.variants[0]!.id}/status`, {
        status: 'active',
      }),
      variantActive.res,
    );
    expect(variantActive.res.statusCode).toBe(200);

    const activeAfter = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), activeAfter.res);
    expect(
      (activeAfter.body().products as Array<{ slug: string }>).some(
        (p) => p.slug === 'STATUS-IMP-1',
      ),
    ).toBe(true);

    const paused = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/products/${draftProduct!.id}/status`, {
        status: 'paused',
      }),
      paused.res,
    );
    expect(paused.res.statusCode).toBe(200);
    expect(paused.body().status).toBe('paused');

    const storefront = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), storefront.res);
    expect(
      (storefront.body().products as Array<{ slug: string }>).some(
        (p) => p.slug === 'STATUS-IMP-1',
      ),
    ).toBe(false);

    const bad = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/products/${draftProduct!.id}/status`, {
        status: 'nope',
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('invalid_status');
  });
});
