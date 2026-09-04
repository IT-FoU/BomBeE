import type { PGlite } from '@electric-sql/pglite';

import type { BombeeEnv } from '@bombee/config';

import { createTestDatabase } from '../db/migrate.js';
import { CatalogService } from '../modules/catalog/catalogService.js';
import { IdentityService } from '../modules/identity/service.js';
import { MockSmsProvider } from '../modules/identity/otp.js';
import { OrderService } from '../modules/orders/orderService.js';
import { ManualBankAdapter, PaymentService } from '../modules/payments/paymentService.js';
import { InviteService } from '../modules/staging/inviteService.js';
import { StoreService } from '../modules/stores/storeService.js';
import { seedLocalCatalog } from './seedLocalCatalog.js';

export type ApiServices = {
  db: PGlite;
  sms: MockSmsProvider;
  identity: IdentityService;
  invites: InviteService;
  stores: StoreService;
  catalog: CatalogService;
  orders: OrderService;
  payments: PaymentService;
};

/** Local/mock runtime: in-memory PGlite + mock SMS (no hosted DB required). */
export async function createLocalApiServices(_env: BombeeEnv): Promise<ApiServices> {
  const db = await createTestDatabase();
  const sms = new MockSmsProvider();
  const identity = new IdentityService(db, sms);
  const invites = new InviteService(db);
  const stores = new StoreService(db);
  const catalog = new CatalogService(db);
  const orders = new OrderService(db);
  const payments = new PaymentService(db, new ManualBankAdapter());
  await seedLocalCatalog(db);
  return { db, sms, identity, invites, stores, catalog, orders, payments };
}
