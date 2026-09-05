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
    body: () =>
      JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
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

describe('owner recovery mock-create HTTP', () => {
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

  it('lists empty then mock-creates an owner recovery request', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/identity/owner-recovery-requests'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().requests).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/identity/owner-recovery/mock-create', {
        reason: 'QA owner recovery 75',
        evidenceRef: 'qa-evidence/owner-75',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(created.body().requestId).toBeTruthy();
    expect(created.body().ownerIdentityId).toBeTruthy();
    expect(created.body().status).toBe('pending');
    expect(created.body().reason).toBe('QA owner recovery 75');
    const requests = created.body().requests as Array<{
      requestId: string;
      status: string;
      evidenceRef: string;
    }>;
    expect(requests.some((r) => r.requestId === created.body().requestId)).toBe(true);
    expect(requests.some((r) => r.evidenceRef === 'qa-evidence/owner-75')).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/identity/owner-recovery-requests'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect(
      (listed.body().requests as Array<{ requestId: string }>).some(
        (r) => r.requestId === created.body().requestId,
      ),
    ).toBe(true);
  });
});
