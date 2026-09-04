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

describe('catalog media HTTP', () => {
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

  it('uploads media, lists it, and issues signed URL', async () => {
    const products = mockRes();
    await router(mockReq('GET', '/v1/catalog/products'), products.res);
    const productId = (
      products.body().products as Array<{ id: string }>
    )[0]!.id;

    const uploaded = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/media/mock-upload', {
        productId,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        byteSize: 120000,
        widthPx: 800,
        heightPx: 800,
      }),
      uploaded.res,
    );
    expect(uploaded.res.statusCode).toBe(201);
    const mediaId = uploaded.body().mediaId as string;
    expect(mediaId).toBeTruthy();
    expect(String(uploaded.body().thumbnailKey)).toContain('.thumb.');

    const list = mockRes();
    await router(mockReq('GET', '/v1/catalog/media'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().media as Array<{ mediaId: string; validationStatus: string }>).some(
        (m) => m.mediaId === mediaId && m.validationStatus === 'passed',
      ),
    ).toBe(true);

    const signed = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/media/${mediaId}/signed-url`, {}),
      signed.res,
    );
    expect(signed.res.statusCode).toBe(200);
    expect(String(signed.body().token)).toHaveLength(64);
    expect(signed.body().expiresAt).toBeTruthy();

    const rejected = mockRes();
    await router(
      mockReq('POST', '/v1/ops/catalog/media/mock-upload', {
        productId,
        mimeType: 'text/javascript',
        mediaType: 'image',
        byteSize: 1000,
      }),
      rejected.res,
    );
    expect(rejected.res.statusCode).toBe(400);

    const missing = mockRes();
    await router(
      mockReq('POST', `/v1/ops/catalog/media/${crypto.randomUUID()}/signed-url`, {}),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
  });
});
