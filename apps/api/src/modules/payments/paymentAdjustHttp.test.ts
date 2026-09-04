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

describe('payment adjustments HTTP', () => {
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

  it('creates mismatch, resolves with adjustment, and approves maker-checker', async () => {
    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payments/mismatches/mock-create', {
        expectedLak: 5000,
        actualLak: 6000,
        mismatchType: 'bank',
      }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const mismatchId = created.body().mismatchId as string;
    expect(mismatchId).toBeTruthy();

    const resolved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/payments/mismatches/${mismatchId}/resolve`, {
        note: 'timing difference resolved locally',
        createAdjustment: true,
        amountLak: 1000,
      }),
      resolved.res,
    );
    expect(resolved.res.statusCode).toBe(200);
    expect(resolved.body().status).toBe('resolved');
    const adjustmentId = resolved.body().adjustmentId as string;
    expect(adjustmentId).toBeTruthy();

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/payments/adjustments/${adjustmentId}/approve`, {}),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('approved');

    const mismatches = mockRes();
    await router(mockReq('GET', '/v1/payments/mismatches'), mismatches.res);
    expect(
      (mismatches.body().mismatches as Array<{ mismatchId: string; status: string }>).some(
        (m) => m.mismatchId === mismatchId && m.status === 'resolved',
      ),
    ).toBe(true);

    const adjustments = mockRes();
    await router(mockReq('GET', '/v1/payments/adjustments'), adjustments.res);
    expect(
      (adjustments.body().adjustments as Array<{ adjustmentId: string; status: string }>).some(
        (a) => a.adjustmentId === adjustmentId && a.status === 'approved',
      ),
    ).toBe(true);
  });
});
