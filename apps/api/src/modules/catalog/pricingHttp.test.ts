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

describe('pricing HTTP', () => {
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

  it('proposes and approves price changes including below-cost', async () => {
    const seeded = mockRes();
    await router(mockReq('GET', '/v1/pricing/requests'), seeded.res);
    expect(seeded.res.statusCode).toBe(200);
    expect(Array.isArray(seeded.body().requests)).toBe(true);

    const proposed = mockRes();
    await router(
      mockReq('POST', '/v1/ops/pricing/mock-propose', {
        sellingPriceLak: 8500,
        costLak: 5000,
      }),
      proposed.res,
    );
    expect(proposed.res.statusCode).toBe(201);
    const requestId = proposed.body().requestId as string;
    expect(proposed.body().belowCost).toBe(false);
    expect(requestId).toBeTruthy();

    const approved = mockRes();
    await router(mockReq('POST', `/v1/ops/pricing/${requestId}/approve`, {}), approved.res);
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('approved');

    const below = mockRes();
    await router(
      mockReq('POST', '/v1/ops/pricing/mock-propose', { belowCost: true }),
      below.res,
    );
    expect(below.res.statusCode).toBe(201);
    expect(below.body().belowCost).toBe(true);
    const belowId = below.body().requestId as string;

    const belowApproved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/pricing/${belowId}/approve`, { stepUpVerified: true }),
      belowApproved.res,
    );
    expect(belowApproved.res.statusCode).toBe(200);
    expect(belowApproved.body().status).toBe('approved');

    const list = mockRes();
    await router(mockReq('GET', '/v1/pricing/requests?limit=20'), list.res);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === belowId && r.status === 'approved',
      ),
    ).toBe(true);
  });
});
