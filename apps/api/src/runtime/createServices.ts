import type { PGlite } from '@electric-sql/pglite';

import type { BombeeEnv } from '@bombee/config';

import { createTestDatabase } from '../db/migrate.js';
import { IdentityService } from '../modules/identity/service.js';
import { MockSmsProvider } from '../modules/identity/otp.js';

export type ApiServices = {
  db: PGlite;
  sms: MockSmsProvider;
  identity: IdentityService;
};

/** Local/mock runtime: in-memory PGlite + mock SMS (no hosted DB required). */
export async function createLocalApiServices(_env: BombeeEnv): Promise<ApiServices> {
  const db = await createTestDatabase();
  const sms = new MockSmsProvider();
  const identity = new IdentityService(db, sms);
  return { db, sms, identity };
}
