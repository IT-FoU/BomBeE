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

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const stream = {
    method,
    url,
    headers: { host: 'localhost', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  return stream as unknown as IncomingMessage;
}

describe('ops HTTP invites + stores', () => {
  const env = parseEnv({
    APP_ENV: 'local',
    PUBLIC_API_URL: 'http://localhost:8787',
    PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
    PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
    EGO_POS_ENABLED: 'false',
    INTEGRATIONS_MODE: 'mock',
    INVITE_ONLY_ENABLED: 'true',
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

  it('creates invite via HTTP and redeems on OTP verify', async () => {
    const create = mockRes();
    await router(
      mockReq('POST', '/v1/invites', {
        inviteCode: 'qa-ops-1',
        intendedRole: 'customer',
        maxUses: 2,
        note: 'ops http test',
      }),
      create.res,
    );
    expect(create.res.statusCode).toBe(201);
    expect((create.body().invite as { inviteCode: string }).inviteCode).toBe('QA-OPS-1');

    const phone = '+8562099001122';
    const reqOtp = mockRes();
    await router(
      mockReq('POST', '/v1/auth/otp/request', {
        phoneE164: phone,
        inviteCode: 'QA-OPS-1',
      }),
      reqOtp.res,
    );
    expect(reqOtp.res.statusCode).toBe(200);
    const devCode = reqOtp.body().devCode as string;

    const verify = mockRes();
    await router(
      mockReq('POST', '/v1/auth/otp/verify', {
        phoneE164: phone,
        code: devCode,
        inviteCode: 'QA-OPS-1',
      }),
      verify.res,
    );
    expect(verify.res.statusCode).toBe(200);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/invites'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    const invites = listed.body().invites as Array<{ inviteCode: string; useCount: number }>;
    const row = invites.find((i) => i.inviteCode === 'QA-OPS-1');
    expect(row?.useCount).toBe(1);
  });

  it('creates and lists store drafts via HTTP', async () => {
    const create = mockRes();
    await router(
      mockReq('POST', '/v1/stores', { name: 'QA Vientiane Mart', code: 'QA-VTK-1' }),
      create.res,
    );
    expect(create.res.statusCode).toBe(201);
    expect((create.body().store as { code: string }).code).toBe('QA-VTK-1');

    const listed = mockRes();
    await router(mockReq('GET', '/v1/stores'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    const stores = listed.body().stores as Array<{ code: string; name: string }>;
    expect(stores.some((s) => s.code === 'QA-VTK-1')).toBe(true);
  });
});
