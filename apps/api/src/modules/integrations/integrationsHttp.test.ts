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

describe('integrations HTTP', () => {
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

  it('reports mode flags and ensures ego profiles without traffic', async () => {
    const status = mockRes();
    await router(mockReq('GET', '/v1/integrations'), status.res);
    expect(status.res.statusCode).toBe(200);
    const body = status.body();
    expect(body.integrationsMode).toBe('mock');
    expect(body.egoPosEnabled).toBe(false);
    expect(body.canSendEgoTraffic).toBe(false);
    expect(Array.isArray(body.checklist)).toBe(true);
    expect(
      (body.checklist as Array<{ id: string; ok: boolean }>).every((c) => c.ok),
    ).toBe(true);

    const ensured = mockRes();
    await router(mockReq('POST', '/v1/ops/integrations/ego/mock-ensure', {}), ensured.res);
    expect(ensured.res.statusCode).toBe(200);
    const profiles = ensured.body().profiles as Array<{ status: string }>;
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.every((p) => p.status === 'disabled')).toBe(true);

    const again = mockRes();
    await router(mockReq('GET', '/v1/integrations'), again.res);
    const stores = again.body().stores as Array<{
      storeCode: string;
      egoDisplay: string;
      featureFlagOn: boolean;
      credentialsConfigured: boolean;
    }>;
    expect(stores.some((s) => s.storeCode === 'LOCAL-FRESH')).toBe(true);
    expect(stores.every((s) => s.egoDisplay === 'Disabled/Not configured')).toBe(true);
    expect(stores.every((s) => !s.featureFlagOn && !s.credentialsConfigured)).toBe(true);
  });
});
