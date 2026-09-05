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

describe('store contacts HTTP', () => {
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

  it('adds and lists store contacts; rejects duplicate primary owner', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/stores', { name: 'Contact QA Mart', code: 'CTQA01' }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const storeId = (created.body().store as { id: string }).id;
    expect(storeId).toBeTruthy();

    const missing = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/00000000-0000-4000-8000-000000000069/contacts/mock-add', {
        contactType: 'owner',
        fullName: 'Ghost',
        phoneE164: '+8562083000068',
      }),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('store_not_found');

    const added = mockRes();
    await router(
      mockReq('POST', `/v1/ops/stores/${storeId}/contacts/mock-add`, {
        contactType: 'owner',
        fullName: 'Owner QA',
        phoneE164: '+8562083000069',
        isPrimary: true,
      }),
      added.res,
    );
    expect(added.res.statusCode).toBe(201);
    expect(added.body().ok).toBe(true);
    const contactId = added.body().contactId as string;
    expect(contactId).toBeTruthy();
    expect((added.body().contacts as unknown[]).length).toBeGreaterThan(0);

    const listed = mockRes();
    await router(mockReq('GET', `/v1/stores/contacts?storeId=${storeId}`), listed.res);
    expect(listed.res.statusCode).toBe(200);
    const contacts = listed.body().contacts as Array<{
      contactId: string;
      contactType: string;
      isPrimary: boolean;
    }>;
    expect(contacts.some((c) => c.contactId === contactId && c.contactType === 'owner')).toBe(
      true,
    );

    const dup = mockRes();
    await router(
      mockReq('POST', `/v1/ops/stores/${storeId}/contacts/mock-add`, {
        contactType: 'owner',
        fullName: 'Second Owner',
        phoneE164: '+8562083000070',
        isPrimary: true,
      }),
      dup.res,
    );
    expect(dup.res.statusCode).toBe(409);
    expect(dup.body().error).toBe('primary_owner_exists');

    const ops = mockRes();
    await router(
      mockReq('POST', `/v1/ops/stores/${storeId}/contacts/mock-add`, {
        contactType: 'ops',
        fullName: 'Ops QA',
        phoneE164: '+8562083000071',
        isPrimary: false,
      }),
      ops.res,
    );
    expect(ops.res.statusCode).toBe(201);
  });
});
