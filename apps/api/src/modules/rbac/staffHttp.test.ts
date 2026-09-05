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

  it('locks a non-owner staff identity and unlocks via ops', async () => {
    const lock = mockRes();
    await router(mockReq('POST', '/v1/ops/identity/mock-lock', {}), lock.res);
    expect(lock.res.statusCode).toBe(200);
    expect(lock.body().status).toBe('locked');
    const lockedId = lock.body().identityId as string;
    expect(lockedId).toBeTruthy();
    expect(
      (lock.body().staff as Array<{ identityId: string; status: string }>).some(
        (s) => s.identityId === lockedId && s.status === 'locked',
      ),
    ).toBe(true);

    const ownerLock = mockRes();
    await router(
      mockReq('POST', '/v1/ops/identity/mock-lock', {
        subject: 'staff:local-catalog-owner',
      }),
      ownerLock.res,
    );
    expect(ownerLock.res.statusCode).toBe(400);
    expect(ownerLock.body().error).toBe('owner_lock_forbidden');

    const unlock = mockRes();
    await router(
      mockReq('POST', `/v1/ops/staff/${lockedId}/unlock`, { reason: 'qa unlock' }),
      unlock.res,
    );
    expect(unlock.res.statusCode).toBe(200);
    expect(unlock.body().status).toBe('active');
    expect(
      (unlock.body().staff as Array<{ identityId: string; status: string }>).some(
        (s) => s.identityId === lockedId && s.status === 'active',
      ),
    ).toBe(true);

    const self = mockRes();
    const owner = (
      unlock.body().staff as Array<{ identityId: string; subject: string }>
    ).find((s) => s.subject === 'staff:local-catalog-owner');
    expect(owner?.identityId).toBeTruthy();
    await router(
      mockReq('POST', `/v1/ops/staff/${owner!.identityId}/unlock`, {}),
      self.res,
    );
    expect([400, 403]).toContain(self.res.statusCode);
    expect(['self_unlock_forbidden', 'insufficient_role']).toContain(self.body().error);
  });


  it('assigns a role via mock-assign and rejects invalid role codes', async () => {
    const listed = mockRes();
    await router(mockReq('GET', '/v1/staff'), listed.res);
    expect(listed.res.statusCode).toBe(200);
    const staff = listed.body().staff as Array<{
      staffProfileId: string;
      subject: string;
      roles: string[];
    }>;
    const maker = staff.find((s) => s.subject === 'staff:local-catalog-maker');
    expect(maker?.staffProfileId).toBeTruthy();

    const assigned = mockRes();
    await router(
      mockReq('POST', `/v1/ops/staff/${maker!.staffProfileId}/roles/mock-assign`, {
        roleCode: 'support',
      }),
      assigned.res,
    );
    expect(assigned.res.statusCode).toBe(200);
    expect(assigned.body().roleCode).toBe('support');
    expect(
      (assigned.body().assignedRoles as string[]).includes('support'),
    ).toBe(true);
    expect(
      (assigned.body().staff as Array<{ staffProfileId: string; roles: string[] }>).some(
        (s) => s.staffProfileId === maker!.staffProfileId && s.roles.includes('support'),
      ),
    ).toBe(true);

    const bad = mockRes();
    await router(
      mockReq('POST', `/v1/ops/staff/${maker!.staffProfileId}/roles/mock-assign`, {
        roleCode: 'not-a-role',
      }),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body().error).toBe('invalid_role_code');

    const missing = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/ops/staff/00000000-0000-4000-8000-000000000070/roles/mock-assign',
        { roleCode: 'finance' },
      ),
      missing.res,
    );
    expect(missing.res.statusCode).toBe(404);
    expect(missing.body().error).toBe('staff_profile_not_found');
  });

});
