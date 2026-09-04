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

describe('backups HTTP', () => {
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

  it('lists, runs, verifies, and restore-drills backups', async () => {
    const empty = mockRes();
    await router(mockReq('GET', '/v1/backups'), empty.res);
    expect(empty.res.statusCode).toBe(200);
    expect(empty.body().jobs).toEqual([]);
    expect(empty.body().alerts).toEqual([]);

    const created = mockRes();
    await router(
      mockReq('POST', '/v1/ops/backups/mock-run', { job_type: 'daily_critical' }),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const jobId = created.body().jobId as string;
    expect(created.body().status).toBe('completed');
    expect(jobId).toBeTruthy();

    const verified = mockRes();
    await router(mockReq('POST', `/v1/ops/backups/${jobId}/verify`, {}), verified.res);
    expect(verified.res.statusCode).toBe(200);
    expect(verified.body().ok).toBe(true);

    const drill = mockRes();
    await router(mockReq('POST', `/v1/ops/backups/${jobId}/restore-drill`, {}), drill.res);
    expect(drill.res.statusCode).toBe(200);
    expect(drill.body().ok).toBe(true);

    const failed = mockRes();
    await router(
      mockReq('POST', '/v1/ops/backups/mock-run', { job_type: 'pre_migration', fail: true }),
      failed.res,
    );
    expect(failed.res.statusCode).toBe(201);
    expect(failed.body().status).toBe('failed');
    const alerts = failed.body().alerts as Array<{ message: string }>;
    expect(alerts.some((a) => a.message === 'backup_failed')).toBe(true);
  });
});
