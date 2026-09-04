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

describe('support tickets HTTP', () => {
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

  it('lists, creates, replies, and resolves tickets', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/support/tickets'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().tickets).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-create', {
        subject: 'Payment stuck',
        body: 'QR not confirming',
        urgency: 'urgent',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const ticketId = created.body().ticketId as string;
    expect(ticketId).toBeTruthy();
    expect(
      (created.body().tickets as Array<{ ticketId: string; status: string; urgency: string }>).some(
        (t) => t.ticketId === ticketId && t.status === 'open' && t.urgency === 'urgent',
      ),
    ).toBe(true);

    const reply = mockRes();
    await router(
      mockReq('POST', `/v1/ops/support/tickets/${ticketId}/reply`, {
        body: 'Checking payment ledger now.',
      }),
      reply.res,
    );
    expect(reply.res.statusCode).toBe(200);
    expect(reply.body().status).toBe('awaiting_customer');

    const resolve = mockRes();
    await router(mockReq('POST', `/v1/ops/support/tickets/${ticketId}/resolve`, {}), resolve.res);
    expect(resolve.res.statusCode).toBe(200);
    expect(resolve.body().status).toBe('resolved_pending_confirm');

    const list = mockRes();
    await router(mockReq('GET', '/v1/support/tickets'), list.res);
    const tickets = list.body().tickets as Array<{
      ticketId: string;
      status: string;
      messageCount: number;
    }>;
    const row = tickets.find((t) => t.ticketId === ticketId);
    expect(row?.status).toBe('resolved_pending_confirm');
    expect(Number(row?.messageCount)).toBeGreaterThanOrEqual(2);
  });
});
