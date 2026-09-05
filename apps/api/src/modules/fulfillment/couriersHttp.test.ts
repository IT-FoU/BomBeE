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

describe('courier mock-create HTTP', () => {
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

  it('lists seed courier and mock-creates another with contract', async () => {
    const listed = mockRes();
    await router(mockReq('GET', '/v1/couriers'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    const before = listed.body().couriers as Array<{ code: string; courierId: string }>;
    expect(before.some((c) => c.code === 'LOCAL-MOCK')).toBe(true);
    const beforeCount = before.length;

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/couriers/mock-create', {
        code: 'QA-COURIER-73',
        name: 'QA Courier 73',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(created.body().courierId).toBeTruthy();
    expect(created.body().contractId).toBeTruthy();
    expect(created.body().code).toBe('QA-COURIER-73');
    const couriers = created.body().couriers as Array<{ code: string }>;
    expect(couriers.length).toBe(beforeCount + 1);
    expect(couriers.some((c) => c.code === 'QA-COURIER-73')).toBe(true);

    const again = mockRes();
    await router(mockReq('GET', '/v1/couriers'), again.res);
    expect(again.res.statusCode).toBe(200);
    expect(
      (again.body().couriers as Array<{ code: string }>).some((c) => c.code === 'QA-COURIER-73'),
    ).toBe(true);
  });

  it('rejects duplicate courier codes', async () => {
    const first = mockRes();
    await router(
      mockReq('POST', '/v1/ops/couriers/mock-create', {
        code: 'QA-DUP-73',
        name: 'Dup One',
      }),
      first.res,
    );
    expect(first.res.statusCode).toBe(201);

    const dup = mockRes();
    await router(
      mockReq('POST', '/v1/ops/couriers/mock-create', {
        code: 'QA-DUP-73',
        name: 'Dup Two',
      }),
      dup.res,
    );
    expect(dup.res.statusCode).toBe(409);
  });
});
