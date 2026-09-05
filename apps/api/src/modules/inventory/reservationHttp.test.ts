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

describe('inventory reservations HTTP', () => {
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

  it('lists, mock-consumes, and mock-expires due reservations', async () => {
    const before = mockRes();
    await router(mockReq('GET', '/v1/inventory/reservations'), before.res);
    expect(before.res.statusCode).toBe(200);
    const beforeCount = (before.body().reservations as unknown[]).length;

    const consumed = mockRes();
    await router(mockReq('POST', '/v1/ops/inventory/reservations/mock-consume', {}), consumed.res);
    expect(consumed.res.statusCode).toBe(200);
    expect(consumed.body().ok).toBe(true);
    expect(consumed.body().reservationId).toBeTruthy();
    expect(consumed.body().status).toBe('consumed');
    expect(
      (consumed.body().reservations as Array<{ reservationId: string; status: string }>).some(
        (r) => r.reservationId === consumed.body().reservationId && r.status === 'consumed',
      ),
    ).toBe(true);

    const expired = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/reservations/mock-expire-due', { ensureDue: true }),
      expired.res,
    );
    expect(expired.res.statusCode).toBe(200);
    expect(expired.body().ok).toBe(true);
    expect(Number(expired.body().expiredCount)).toBeGreaterThan(0);
    expect(
      (expired.body().reservations as Array<{ status: string }>).some((r) => r.status === 'expired'),
    ).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/inventory/reservations?limit=50'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect((listed.body().reservations as unknown[]).length).toBeGreaterThan(beforeCount);
  });
});
