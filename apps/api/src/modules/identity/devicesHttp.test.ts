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

describe('identity devices mock-create HTTP', () => {
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

  it('lists empty then mock-registers a device (idempotent on fingerprint)', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/identity/devices'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().devices).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/identity/devices/mock-create', {
        fingerprint: 'qa-device-76',
        userAgent: 'vitest/qa',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    expect(created.body().deviceId).toBeTruthy();
    expect(created.body().isNew).toBe(true);
    expect(created.body().fingerprint).toBe('qa-device-76');
    const devices = created.body().devices as Array<{ deviceId: string; fingerprint: string }>;
    expect(devices.some((d) => d.fingerprint === 'qa-device-76')).toBe(true);

    const again = mockRes();
    await router(
      mockReq('POST', '/v1/ops/identity/devices/mock-create', {
        fingerprint: 'qa-device-76',
      }),
      again.res,
    );
    expect(again.res.statusCode).toBe(201);
    expect(again.body().isNew).toBe(false);
    expect(again.body().deviceId).toBe(created.body().deviceId);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/identity/devices'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect(
      (listed.body().devices as Array<{ fingerprint: string }>).some(
        (d) => d.fingerprint === 'qa-device-76',
      ),
    ).toBe(true);
  });
});
