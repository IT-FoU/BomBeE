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

describe('exports HTTP', () => {
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

  it('creates, approves, and downloads exports without exposing ciphertext', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/exports'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().exports).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/exports/mock-create', {
        export_type: 'customers',
        reason: 'monthly compliance extract',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const exportId = created.body().exportId as string;
    expect(exportId).toBeTruthy();
    expect(JSON.stringify(created.body())).not.toMatch(/ciphertext|artifact/i);

    const approve = mockRes();
    await router(mockReq('POST', `/v1/ops/exports/${exportId}/approve`, {}), approve.res);
    expect(approve.res.statusCode).toBe(200);
    expect(approve.body().status).toBe('approved');

    const download = mockRes();
    await router(mockReq('POST', `/v1/ops/exports/${exportId}/mock-download`, {}), download.res);
    expect(download.res.statusCode).toBe(200);
    expect(download.body().status).toBe('ready');
    expect(Number(download.body().downloadCount)).toBe(1);

    const list = mockRes();
    await router(mockReq('GET', '/v1/exports'), list.res);
    const exports = list.body().exports as Array<{ exportId: string; status: string }>;
    expect(exports.some((e) => e.exportId === exportId && e.status === 'ready')).toBe(true);
  });
});
