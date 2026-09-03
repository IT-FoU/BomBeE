import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';

describe('RLS policies', () => {
  let db: PGlite;
  let customerA: string;
  let customerB: string;
  let profileA: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    customerA = await identity.ensureCustomer('+8562093330001', 'A');
    customerB = await identity.ensureCustomer('+8562093330002', 'B');
    const row = await db.query<{ id: string }>(
      `SELECT id FROM app.customer_profiles WHERE auth_identity_id = $1`,
      [customerA],
    );
    profileA = row.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('denies cross-user customer profile reads for authenticated role', async () => {
    await db.exec(`SET ROLE bombee_authenticated`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [customerB]);

    const visible = await db.query<{ id: string }>(`SELECT id FROM app.customer_profiles`);
    expect(visible.rows.find((r) => r.id === profileA)).toBeUndefined();

    await db.exec(`RESET ROLE`);
  });

  it('allows service role to read all customer profiles', async () => {
    await db.exec(`SET ROLE bombee_service`);
    const all = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.customer_profiles`,
    );
    expect(all.rows[0]!.n).toBeGreaterThanOrEqual(2);
    await db.exec(`RESET ROLE`);
  });
});
