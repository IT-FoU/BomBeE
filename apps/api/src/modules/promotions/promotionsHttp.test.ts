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

describe('promotions HTTP', () => {
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

  it('lists, creates, and pauses promotions', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/promotions'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().promotions).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/promotions/mock-create', {
        code: 'QA10',
        title_en: 'QA ten percent',
        percent_off: 10,
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const promotionId = created.body().promotionId as string;
    expect(promotionId).toBeTruthy();
    expect(
      (created.body().promotions as Array<{ code: string; status: string }>).some(
        (p) => p.code === 'QA10' && p.status === 'active',
      ),
    ).toBe(true);

    const pause = mockRes();
    await router(mockReq('POST', `/v1/ops/promotions/${promotionId}/pause`, {}), pause.res);
    expect(pause.res.statusCode).toBe(200);
    expect(pause.body().status).toBe('paused');

    const list = mockRes();
    await router(mockReq('GET', '/v1/promotions'), list.res);
    const promotions = list.body().promotions as Array<{ promotionId: string; status: string }>;
    expect(promotions.some((p) => p.promotionId === promotionId && p.status === 'paused')).toBe(
      true,
    );
  });
});
