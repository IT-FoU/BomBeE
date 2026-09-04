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

describe('customer support HTTP', () => {
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
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
    const identityId = await services.identity.ensureCustomer('+8562097222050', 'Support QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
    const otherId = await services.identity.ensureCustomer('+8562097222051', 'Other QA');
    otherToken = await services.identity.createSession({
      authIdentityId: otherId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('creates, lists, and confirm-closes own tickets', async () => {
    const created = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/support/tickets',
        {
          subject: 'Where is my order?',
          body: 'Need ETA for WATER-12',
          channel: 'in_app',
          urgency: 'general',
        },
        { authorization: `Bearer ${token}` },
      ),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const ticketId = created.body().ticketId as string;
    expect(ticketId).toBeTruthy();

    const list = mockRes();
    await router(
      mockReq('GET', '/v1/me/support/tickets', undefined, {
        authorization: `Bearer ${token}`,
      }),
      list.res,
    );
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().tickets as Array<{ ticketId: string }>).some((t) => t.ticketId === ticketId),
    ).toBe(true);

    const otherList = mockRes();
    await router(
      mockReq('GET', '/v1/me/support/tickets', undefined, {
        authorization: `Bearer ${otherToken}`,
      }),
      otherList.res,
    );
    expect(
      (otherList.body().tickets as Array<{ ticketId: string }>).some(
        (t) => t.ticketId === ticketId,
      ),
    ).toBe(false);

    await services.support.markPreliminaryResolved(ticketId);

    const closed = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/me/support/tickets/${ticketId}/confirm-close`,
        {},
        { authorization: `Bearer ${token}` },
      ),
      closed.res,
    );
    expect(closed.res.statusCode).toBe(200);
    expect(closed.body().status).toBe('closed');

    const forbidden = mockRes();
    await router(
      mockReq(
        'POST',
        `/v1/me/support/tickets/${ticketId}/confirm-close`,
        {},
        { authorization: `Bearer ${otherToken}` },
      ),
      forbidden.res,
    );
    expect(forbidden.res.statusCode).toBe(403);
  });
});
