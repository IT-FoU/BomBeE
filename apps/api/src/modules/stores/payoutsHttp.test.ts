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

describe('payouts/contracts HTTP', () => {
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

  it('creates contracts and approves payout changes with 48h hold', async () => {
    const contract = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/contracts/mock-create', {
        revenueModel: 'commission',
        commissionBps: 1200,
      }),
      contract.res,
    );
    expect(contract.res.statusCode).toBe(201);
    expect(contract.body().versionNo).toBeTruthy();

    const contracts = mockRes();
    await router(mockReq('GET', '/v1/stores/contracts'), contracts.res);
    expect(contracts.res.statusCode).toBe(200);
    expect((contracts.body().contracts as unknown[]).length).toBeGreaterThan(0);

    const proposed = mockRes();
    await router(
      mockReq('POST', '/v1/ops/payouts/mock-propose', {
        bankName: 'LDB',
        accountNumberLast4: '4242',
        accountHolder: 'QA Payout',
      }),
      proposed.res,
    );
    expect(proposed.res.statusCode).toBe(201);
    const requestId = proposed.body().requestId as string;
    expect(requestId).toBeTruthy();

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/payouts/${requestId}/approve`, { stepUpVerified: true }),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('approved');
    expect(approved.body().holdUntil).toBeTruthy();

    const list = mockRes();
    await router(mockReq('GET', '/v1/payouts/requests'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().requests as Array<{ requestId: string; status: string }>).some(
        (r) => r.requestId === requestId && r.status === 'approved',
      ),
    ).toBe(true);
    expect(
      (list.body().accounts as Array<{ status: string; payoutHoldUntil: string | null }>).some(
        (a) => a.status === 'active' && a.payoutHoldUntil !== null,
      ),
    ).toBe(true);
  });

  it('snapshots contract terms onto a child order via HTTP', async () => {
    const before = mockRes();
    await router(mockReq('GET', '/v1/stores/order-contract-snapshots'), before.res);
    expect(before.res.statusCode).toBe(200);
    const beforeCount = (before.body().snapshots as unknown[]).length;

    const snapped = mockRes();
    await router(mockReq('POST', '/v1/ops/stores/contracts/mock-snapshot', {}), snapped.res);
    expect(snapped.res.statusCode).toBe(201);
    expect(snapped.body().ok).toBe(true);
    expect(snapped.body().childOrderId).toBeTruthy();
    expect(snapped.body().contractVersionId).toBeTruthy();
    expect(
      (snapped.body().snapshots as Array<{ childOrderId: string }>).some(
        (s) => s.childOrderId === snapped.body().childOrderId,
      ),
    ).toBe(true);

    const listed = mockRes();
    await router(mockReq('GET', '/v1/stores/order-contract-snapshots?limit=50'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    expect((listed.body().snapshots as unknown[]).length).toBe(beforeCount + 1);

    const dup = mockRes();
    await router(
      mockReq('POST', '/v1/ops/stores/contracts/mock-snapshot', {
        child_order_id: snapped.body().childOrderId,
      }),
      dup.res,
    );
    expect(dup.res.statusCode).toBe(409);
    expect(dup.body().error).toBe('contract_snapshot_exists');
  });
});
