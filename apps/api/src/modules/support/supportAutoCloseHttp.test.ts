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

describe('support auto-close HTTP', () => {
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

  it('auto-closes stale resolved tickets via mock ops', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-create', {
        subject: 'Auto-close QA',
        body: 'Please close me later',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const ticketId = created.body().ticketId as string;

    const resolved = mockRes();
    await router(mockReq('POST', `/v1/ops/support/tickets/${ticketId}/resolve`, {}), resolved.res);
    expect(resolved.res.statusCode).toBe(200);

    const early = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-auto-close', {
        ticket_id: ticketId,
        now: new Date().toISOString(),
      }),
      early.res,
    );
    expect(early.res.statusCode).toBe(200);
    expect(early.body().closed).toBe(false);

    const late = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-auto-close', {
        ticket_id: ticketId,
        now: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
      }),
      late.res,
    );
    expect(late.res.statusCode).toBe(200);
    expect(late.body().closed).toBe(true);
    expect(
      (late.body().tickets as Array<{ ticketId: string; status: string }>).some(
        (t) => t.ticketId === ticketId && t.status === 'closed',
      ),
    ).toBe(true);
  });
});
