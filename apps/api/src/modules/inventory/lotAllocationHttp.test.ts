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

describe('inventory lot allocation evaluate HTTP', () => {
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

  it('mock-evaluates a short food lot and lists expiry alerts', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/inventory/lot-expiry-alerts'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    const before = (empty.body().alerts as unknown[]).length;

    const evaluated = mockRes();
    await router(
      mockReq('POST', '/v1/ops/inventory/lots/mock-evaluate-allocation', {
        categorySlug: 'food',
        now: '2026-09-03T00:00:00.000Z',
        expiryDate: '2026-09-20',
      }),
      evaluated.res,
    );
    expect(evaluated.res.statusCode).toBe(200);
    expect(evaluated.body().lotId).toBeTruthy();
    const decision = evaluated.body().decision as { ok: boolean; reason?: string };
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('below_min_shelf_life');
    const alerts = evaluated.body().alerts as Array<{
      lotId: string;
      alertType: string;
      remainingDays: number;
    }>;
    expect(alerts.length).toBeGreaterThan(before);
    expect(alerts.some((a) => a.lotId === evaluated.body().lotId)).toBe(true);
    expect(alerts[0]!.alertType).toMatch(/near_minimum|expired/);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/inventory/lot-expiry-alerts'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect(
      (listed.body().alerts as Array<{ lotId: string }>).some(
        (a) => a.lotId === evaluated.body().lotId,
      ),
    ).toBe(true);
  });
});
