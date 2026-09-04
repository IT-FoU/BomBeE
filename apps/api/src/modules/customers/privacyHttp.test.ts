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

describe('privacy HTTP', () => {
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
  let token: string;

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
    const identityId = await services.identity.ensureCustomer('+8562097222001', 'Privacy QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('starts and confirms dual-OTP phone change and lists recovery docs', async () => {
    const identityId = await services.identity.ensureCustomer('+8562097222010', 'Phone Change QA');
    const phoneToken = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });

    const start = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/phone-change/start',
        { newPhone: '+8562097222011' },
        { authorization: `Bearer ${phoneToken}` },
      ),
      start.res,
    );
    expect(start.res.statusCode).toBe(200);
    const correlationId = start.body().correlationId as string;
    const oldCode = start.body().devOldCode as string;
    const newCode = start.body().devNewCode as string;
    expect(correlationId).toBeTruthy();
    expect(oldCode).toMatch(/^\d{6}$/);
    expect(newCode).toMatch(/^\d{6}$/);

    const confirm = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/phone-change/confirm',
        { correlationId, oldCode, newCode },
        { authorization: `Bearer ${phoneToken}` },
      ),
      confirm.res,
    );
    expect(confirm.res.statusCode).toBe(200);
    expect((confirm.body().profile as { phoneE164: string }).phoneE164).toBe('+8562097222011');

    const recovery = mockRes();
    await router(
      mockReq('POST', '/v1/me/recovery-document', {
        claimedPhone: '+8562097222099',
        documentStorageKey: 'private/recovery/qa.pdf',
      }),
      recovery.res,
    );
    expect(recovery.res.statusCode).toBe(201);
    const requestId = recovery.body().requestId as string;

    const list = mockRes();
    await router(mockReq('GET', '/v1/privacy/recovery-requests'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'pending',
      ),
    ).toBe(true);
  });

  it('manages addresses, marketing opt-in, and deletion approve anonymize', async () => {
    const profile = mockRes();
    await router(
      mockReq('GET', '/v1/me/privacy', undefined, { authorization: `Bearer ${token}` }),
      profile.res,
    );
    expect(profile.res.statusCode).toBe(200);
    expect((profile.body().profile as { displayName: string }).displayName).toBeTruthy();

    const addr = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/addresses',
        {
          recipientName: 'Privacy QA',
          recipientPhoneE164: '+8562097222001',
          addressLine: 'Vientiane',
          isDefault: true,
        },
        { authorization: `Bearer ${token}` },
      ),
      addr.res,
    );
    expect(addr.res.statusCode).toBe(201);
    expect((addr.body().addresses as unknown[]).length).toBe(1);

    const opt = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/marketing-opt-in',
        { optIn: false },
        { authorization: `Bearer ${token}` },
      ),
      opt.res,
    );
    expect(opt.res.statusCode).toBe(200);
    expect((opt.body().profile as { marketingOptIn: boolean }).marketingOptIn).toBe(false);

    const del = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/me/deletion-request',
        { otpVerified: true },
        { authorization: `Bearer ${token}` },
      ),
      del.res,
    );
    expect(del.res.statusCode).toBe(201);
    const requestId = del.body().requestId as string;

    const list = mockRes();
    await router(mockReq('GET', '/v1/privacy/deletion-requests'), list.res);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'pending',
      ),
    ).toBe(true);

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/privacy/deletion-requests/${requestId}/approve`, {}),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('completed');

    const after = mockRes();
    await router(
      mockReq('GET', '/v1/me/privacy', undefined, { authorization: `Bearer ${token}` }),
      after.res,
    );
    expect(after.res.statusCode).toBe(200);
    expect((after.body().profile as { displayName: string }).displayName).toBe('anonymized');
  });
});
