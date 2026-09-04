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

describe('store quality HTTP', () => {
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

  it('records quality events, suspends at threshold, and reactivates', async () => {
    const stores = mockRes();
    await router(mockReq('GET', '/v1/stores'), stores.res);
    const storeId = (stores.body().stores as Array<{ id: string; status: string }>).find(
      (s) => s.status === 'active',
    )?.id;
    expect(storeId).toBeTruthy();

    const burst = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/quality/mock-event', {
        storeId,
        eventType: 'slow_response_or_pack',
        count: 5,
      }),
      burst.res,
    );
    expect(burst.res.statusCode).toBe(201);
    expect((burst.body().result as { suspended: boolean }).suspended).toBe(true);

    const list = mockRes();
    await router(mockReq('GET', `/v1/stores/quality?storeId=${storeId}`), list.res);
    expect(list.res.statusCode).toBe(200);
    expect((list.body().events as unknown[]).length).toBeGreaterThanOrEqual(5);
    expect(
      (list.body().suspensions as Array<{ storeId: string; active: boolean }>).some(
        (s) => s.storeId === storeId && s.active,
      ),
    ).toBe(true);

    const reactivated = mockRes();
    await router(
      mockReq(`POST`, `/v1/ops/stores/${storeId}/reactivate`, {
        evidence: 'hired packer and retrained staff',
      }),
      reactivated.res,
    );
    expect(reactivated.res.statusCode).toBe(200);
    expect(reactivated.body().status).toBe('active');
  });
});
