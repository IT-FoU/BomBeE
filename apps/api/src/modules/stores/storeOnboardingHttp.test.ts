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

describe('store onboarding HTTP', () => {
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

  it('uploads docs, verifies, signs access, ensures fulfillment, and activates', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/stores', { name: 'Onboard QA Mart', code: 'ONBQA01' }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const storeId = (created.body().store as { id: string }).id;
    expect(storeId).toBeTruthy();

    const blocked = mockRes();
    await router(mockReq('POST', `/v1/ops/stores/${storeId}/activate`), blocked.res);
    expect(blocked.res.statusCode).toBe(409);
    expect(blocked.body().error).toBe('onboarding_incomplete');

    const docTypes = ['owner_id', 'store_info', 'bank_account', 'contract'] as const;
    let firstDocId = '';
    for (const docType of docTypes) {
      const uploaded = mockRes();
      await router(
        mockReq('POST', `/v1/ops/stores/${storeId}/documents/mock-upload`, { docType }),
        uploaded.res,
      );
      expect(uploaded.res.statusCode).toBe(201);
      const documentId = uploaded.body().documentId as string;
      if (docType === 'owner_id') firstDocId = documentId;

      const verified = mockRes();
      await router(
        mockReq('POST', `/v1/ops/stores/documents/${documentId}/verify`, { storeId }),
        verified.res,
      );
      expect(verified.res.statusCode).toBe(200);
      expect(verified.body().status).toBe('verified');
    }

    const signed = mockRes();
    await router(
      mockReq('POST', `/v1/ops/stores/documents/${firstDocId}/signed-access`, {
        reason: 'onboarding review',
      }),
      signed.res,
    );
    expect(signed.res.statusCode).toBe(200);
    expect(String(signed.body().token)).toHaveLength(64);

    const fulfill = mockRes();
    await router(
      mockReq('POST', `/v1/ops/stores/${storeId}/fulfillment/mock-ensure`, {
        name: 'Main',
        addressLine: 'Vientiane',
      }),
      fulfill.res,
    );
    expect(fulfill.res.statusCode).toBe(200);
    expect(fulfill.body().locationId).toBeTruthy();

    const onboard = mockRes();
    await router(mockReq('GET', `/v1/stores/${storeId}/onboarding`), onboard.res);
    expect(onboard.res.statusCode).toBe(200);
    expect((onboard.body().activation as { ok: boolean }).ok).toBe(true);

    const checklist = mockRes();
    await router(mockReq('GET', `/v1/stores/${storeId}/checklist`), checklist.res);
    expect(checklist.res.statusCode).toBe(200);
    expect(checklist.body().ok).toBe(true);
    expect(checklist.body().storeId).toBe(storeId);
    const flags = checklist.body().checklist as {
      ownerIdOk: boolean;
      storeInfoOk: boolean;
      bankAccountOk: boolean;
      contractOk: boolean;
    };
    expect(flags.ownerIdOk).toBe(true);
    expect(flags.storeInfoOk).toBe(true);
    expect(flags.bankAccountOk).toBe(true);
    expect(flags.contractOk).toBe(true);

    const missing = mockRes();
    await router(
      mockReq('GET', '/v1/stores/00000000-0000-4000-8000-000000000000/checklist'),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('store_not_found');

    const activated = mockRes();
    await router(mockReq('POST', `/v1/ops/stores/${storeId}/activate`), activated.res);
    expect(activated.res.statusCode).toBe(200);
    expect(activated.body().status).toBe('active');

    const docs = mockRes();
    await router(mockReq('GET', `/v1/stores/documents?storeId=${storeId}`), docs.res);
    expect(docs.res.statusCode).toBe(200);
    expect((docs.body().documents as unknown[]).length).toBeGreaterThanOrEqual(4);
  });
});
