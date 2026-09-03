import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { AuditService } from './service.js';

describe('AuditService', () => {
  let db: PGlite;
  let audit: AuditService;
  let identity: IdentityService;
  let actorId: string;
  let customerProfileId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    identity = new IdentityService(db, new MockSmsProvider());
    audit = new AuditService(db);
    actorId = await identity.ensureCustomer('+8562091110001', 'PII Subject');
    const staff = await identity.ensureStaff('staff:support1', 'Support', '+8562081110001');
    actorId = staff.identityId;
    const profile = await db.query<{ id: string }>(
      `SELECT id FROM app.customer_profiles LIMIT 1`,
    );
    customerProfileId = profile.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('appends audit events and logs customer PII access', async () => {
    const id = await audit.append({
      actorIdentityId: actorId,
      actorType: 'staff',
      action: 'login.success',
      targetType: 'session',
      correlationId: crypto.randomUUID(),
    });
    expect(id).toBeTruthy();

    await audit.logCustomerPiiAccess({
      actorIdentityId: actorId,
      customerProfileId,
      fields: ['phone', 'address'],
      reason: 'support ticket',
      correlationId: crypto.randomUUID(),
    });

    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security.audit_events`,
    );
    expect(count.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it('blocks update and delete on audit_events', async () => {
    const update = await audit.tryMutate('update');
    const del = await audit.tryMutate('delete');
    expect(update.blocked).toBe(true);
    expect(del.blocked).toBe(true);
  });
});
