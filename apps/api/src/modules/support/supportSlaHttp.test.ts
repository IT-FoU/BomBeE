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

describe('support SLA HTTP', () => {
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

  it('evaluates SLA breach, escalates, and lists escalated tickets', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-create', {
        subject: 'SLA QA ticket',
        body: 'Please help',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const ticketId = created.body().ticketId as string;
    expect(ticketId).toBeTruthy();

    const evaluated = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-evaluate-sla', {
        ticket_id: ticketId,
        now: '2099-01-02T00:00:00.000Z',
      }),
      evaluated.res,
    );
    expect(evaluated.res.statusCode).toBe(200);
    expect(evaluated.body().escalated).toBe(true);
    expect(evaluated.body().breaches).toEqual(
      expect.arrayContaining(['first_response', 'resolution']),
    );
    expect(
      (
        evaluated.body().tickets as Array<{
          ticketId: string;
          escalatedAt: string | null;
        }>
      ).some((t) => t.ticketId === ticketId && Boolean(t.escalatedAt)),
    ).toBe(true);

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/support/tickets/mock-evaluate-sla', {
        ticket_id: ticketId,
        now: '2099-01-03T00:00:00.000Z',
      }),
      again.res,
    );
    expect(again.res.statusCode).toBe(200);
    expect(again.body().escalated).toBe(true);
    expect(again.body().breaches).toEqual(
      expect.arrayContaining(['first_response', 'resolution']),
    );

    const escalated = mockRes();
    await router(mockReq('GET', '/v1/support/tickets?escalated=true'), escalated.res);
    expect(escalated.res.statusCode).toBe(200);
    expect(
      (escalated.body().tickets as Array<{ ticketId: string; escalatedAt: string | null }>).every(
        (t) => Boolean(t.escalatedAt),
      ),
    ).toBe(true);
    expect(
      (escalated.body().tickets as Array<{ ticketId: string }>).some(
        (t) => t.ticketId === ticketId,
      ),
    ).toBe(true);
  });
});
