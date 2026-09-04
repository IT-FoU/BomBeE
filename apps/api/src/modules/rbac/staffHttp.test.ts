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

describe('staff HTTP', () => {
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

  it('lists role catalog and seeded staff directory', async () => {
    const res = mockRes();
    await router(mockReq('GET', '/v1/staff'), res.res);
    expect(res.res.statusCode).toBe(200);
    const body = res.body();
    const roles = body.roles as Array<{ role: string; permissions: string[] }>;
    expect(roles).toHaveLength(7);
    expect(roles.find((r) => r.role === 'owner')?.permissions.length).toBeGreaterThan(0);

    const staff = body.staff as Array<{ subject: string; roles: string[] }>;
    expect(staff.some((s) => s.subject === 'staff:local-catalog-owner')).toBe(true);
    expect(
      staff.some(
        (s) => s.subject === 'staff:local-catalog-maker' && s.roles.includes('catalog'),
      ),
    ).toBe(true);
    expect(
      staff.some((s) => s.subject === 'staff:local-catalog-owner' && s.roles.includes('owner')),
    ).toBe(true);
  });
});
