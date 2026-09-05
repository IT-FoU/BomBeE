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

describe('catalog create HTTP', () => {
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

  it('mock-creates brand, product, and variant then lists them in ops catalog', async () => {
    const brand = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/brands/mock-create', {
        slug: 'qa-brand-71',
        name: 'QA Brand 71',
        evidenceStorageKey: 'private/brands/qa-71.pdf',
        verify: true,
      }),
      brand.res,
    );
    expect(brand.res.statusCode).toBe(201);
    const brandId = brand.body().brandId as string;
    expect(brandId).toBeTruthy();

    const product = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/products/mock-create', {
        brandId,
        categorySlug: 'general',
        storeProductId: 'QA-PROD-71',
        titleLo: 'ສິນຄ້າ QA 71',
        titleEn: 'QA Product 71',
      }),
      product.res,
    );
    expect(product.res.statusCode).toBe(201);
    const productId = product.body().productId as string;
    const storeId = product.body().storeId as string;
    expect(productId).toBeTruthy();
    expect(storeId).toBeTruthy();

    const variant = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/variants/mock-create', {
        productId,
        storeId,
        sku: 'QA-SKU-71',
        barcode: '8850000000071',
        hasShelfLife: false,
      }),
      variant.res,
    );
    expect(variant.res.statusCode).toBe(201);
    const variantId = variant.body().variantId as string;
    expect(variantId).toBeTruthy();
    expect(
      (variant.body().products as Array<{ id: string; variants: Array<{ sku: string }> }>).some(
        (p) =>
          p.id === productId && p.variants.some((v) => v.sku === 'QA-SKU-71'),
      ),
    ).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/ops/catalog/products?status=draft'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect(
      (listed.body().products as Array<{ id: string; status: string }>).some(
        (p) => p.id === productId && p.status === 'draft',
      ),
    ).toBe(true);

    const banned = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/products/mock-create', {
        categorySlug: 'weapons',
        storeProductId: 'QA-BAD-71',
        titleEn: 'Should Fail',
      }),
      banned.res,
    );
    expect(banned.res.statusCode).toBe(400);
    expect(banned.body().error).toBe('prohibited_category');
  });
});
