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

describe('auth HTTP OTP routes', () => {
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

  it('requests and verifies customer OTP via HTTP (local exposes devCode)', async () => {
    const phone = '+8562099887766';
    const reqRes = mockRes();
    await router(
      mockReq('POST', '/v1/auth/otp/request', { phoneE164: phone, purpose: 'customer_login' }),
      reqRes.res,
    );
    expect(reqRes.res.statusCode).toBe(200);
    const requested = reqRes.body();
    expect(requested.status).toBe('accepted');
    expect(typeof requested.devCode).toBe('string');

    const verifyRes = mockRes();
    await router(
      mockReq('POST', '/v1/auth/otp/verify', {
        phoneE164: phone,
        purpose: 'customer_login',
        code: requested.devCode,
      }),
      verifyRes.res,
    );
    expect(verifyRes.res.statusCode).toBe(200);
    const verified = verifyRes.body();
    expect(verified.ok).toBe(true);
    expect(typeof verified.sessionToken).toBe('string');
  });

  it('rejects invalid phone on OTP request', async () => {
    const bad = mockRes();
    await router(mockReq('POST', '/v1/auth/otp/request', { phoneE164: '20-123' }), bad.res);
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('invalid_phone');
  });
});
