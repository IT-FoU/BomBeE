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

describe('reports HTTP', () => {
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

  it('returns live dashboard KPIs and payment reconcile', async () => {
    const dash = mockRes();
    await router(mockReq('GET', '/v1/reports/dashboard'), dash.res);
    expect(dash.res.statusCode).toBe(200);
    const kpis = dash.body().kpis as {
      source: string;
      orders: number;
      salesLak: number;
      stockOnHand: number;
      supportOpen: number;
    };
    expect(kpis.source).toBe('live');
    expect(typeof kpis.orders).toBe('number');
    expect(typeof kpis.salesLak).toBe('number');
    expect(kpis.stockOnHand).toBeGreaterThanOrEqual(0);

    const recon = mockRes();
    await router(mockReq('GET', '/v1/reports/payments/reconcile'), recon.res);
    expect(recon.res.statusCode).toBe(200);
    const reconcile = recon.body().reconcile as {
      totalRequests: number;
      mismatchCount: number;
      ok: boolean;
    };
    expect(reconcile.ok).toBe(true);
    expect(reconcile.mismatchCount).toBe(0);
  });
});
