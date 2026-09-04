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

describe('notifications HTTP', () => {
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

  it('enqueues, processes, and marks inbox read', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/notifications'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(Array.isArray(empty.body().inbox)).toBe(true);
    expect(Array.isArray(empty.body().outbox)).toBe(true);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/notifications/mock-enqueue', {
        title: 'QA ping',
        body: 'notifications http test',
        template: 'ops.qa_ping',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const outboxId = created.body().outboxId as string;
    expect(outboxId).toBeTruthy();
    const inboxAfterEnqueue = created.body().inbox as Array<{
      inboxId: string;
      read: boolean;
      title: string;
    }>;
    expect(inboxAfterEnqueue.some((n) => n.title === 'QA ping' && !n.read)).toBe(true);
    const pending = (created.body().outbox as Array<{ outboxId: string; status: string }>).find(
      (o) => o.outboxId === outboxId,
    );
    expect(pending?.status).toBe('pending');

    const processed = mockRes();
    await router(mockReq('POST', '/v1/ops/notifications/mock-process', {}), processed.res);
    expect(processed.res.statusCode).toBe(200);
    const sent = (processed.body().outbox as Array<{ outboxId: string; status: string }>).find(
      (o) => o.outboxId === outboxId,
    );
    expect(sent?.status).toBe('sent');

    const inboxId = inboxAfterEnqueue.find((n) => n.title === 'QA ping')!.inboxId;
    const marked = mockRes();
    await router(
      mockReq('POST', `/v1/ops/notifications/inbox/${inboxId}/mark-read`, {}),
      marked.res,
    );
    expect(marked.res.statusCode).toBe(200);
    const inbox = marked.body().inbox as Array<{ inboxId: string; read: boolean }>;
    expect(inbox.some((n) => n.inboxId === inboxId && n.read)).toBe(true);
  });
});
