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

describe('audit HTTP', () => {
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

  it('lists and appends mock audit events', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/audit/events'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(Array.isArray(empty.body().events)).toBe(true);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/audit/mock-event', {
        action: 'ops.qa_probe',
        reason: 'audit http test',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const eventId = created.body().eventId as string;
    expect(eventId).toBeTruthy();

    const list = mockRes();
    await router(mockReq('GET', '/v1/audit/events'), list.res);
    const events = list.body().events as Array<{ eventId: string; action: string }>;
    expect(events.some((e) => e.eventId === eventId && e.action === 'ops.qa_probe')).toBe(true);
  });
});
