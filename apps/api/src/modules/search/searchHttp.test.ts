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

describe('image search HTTP', () => {
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

  it('searches by barcode/OCR, uploads metadata, and purges expired', async () => {
    const byBarcode = mockRes();
    await router(mockReq('GET', '/v1/search/catalog?barcode=8850123456789'), byBarcode.res);
    expect(byBarcode.res.statusCode).toBe(200);
    const barcodeMatches = byBarcode.body().matches as Array<{ sku: string }>;
    expect(barcodeMatches.some((m) => m.sku === 'WATER-12')).toBe(true);

    const byOcr = mockRes();
    await router(mockReq('GET', '/v1/search/catalog?q=Water'), byOcr.res);
    expect(byOcr.res.statusCode).toBe(200);
    expect((byOcr.body().matches as unknown[]).length).toBeGreaterThan(0);

    const uploaded = mockRes();
    await router(
      mockReq('POST', '/v1/search/image', {
        contentType: 'image/jpeg',
        byteSize: 2048,
        consentSearchOnly: true,
        barcodeValue: '8850123456789',
        ocrText: 'Water',
      }),
      uploaded.res,
    );
    expect(uploaded.res.statusCode).toBe(201);
    expect((uploaded.body().upload as { id: string }).id).toBeTruthy();
    expect(
      ((uploaded.body().matches as Array<{ sku: string }>).some((m) => m.sku === 'WATER-12')),
    ).toBe(true);

    const list = mockRes();
    await router(mockReq('GET', '/v1/search/uploads'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect((list.body().uploads as unknown[]).length).toBeGreaterThan(0);

    const purged = mockRes();
    await router(
      mockReq('POST', '/v1/ops/search/purge-expired', {
        now: '2099-01-01T00:00:00.000Z',
      }),
      purged.res,
    );
    expect(purged.res.statusCode).toBe(200);
    expect((purged.body().deleted as number) >= 1).toBe(true);
  });
});
