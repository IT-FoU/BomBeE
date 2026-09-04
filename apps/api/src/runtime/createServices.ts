import type { PGlite } from '@electric-sql/pglite';

import type { BombeeEnv } from '@bombee/config';

import { createTestDatabase } from '../db/migrate.js';
import { AuditService } from '../modules/audit/service.js';
import { CatalogService } from '../modules/catalog/catalogService.js';
import { ExportService } from '../modules/exports/service.js';
import { DeliveryService } from '../modules/fulfillment/deliveryService.js';
import { ReturnService } from '../modules/fulfillment/returnService.js';
import { SettlementService } from '../modules/fulfillment/settlementService.js';
import { IdentityService } from '../modules/identity/service.js';
import { MockSmsProvider } from '../modules/identity/otp.js';
import { InventoryService } from '../modules/inventory/inventoryService.js';
import { ReservationService } from '../modules/inventory/reservationService.js';
import {
  InMemoryProvider,
  NotificationDispatchService,
} from '../modules/notifications/dispatchService.js';
import {
  BlockedEgoNetwork,
  EgoIntegrationService,
} from '../modules/integrations/egoService.js';
import { OrderService } from '../modules/orders/orderService.js';
import { ManualBankAdapter, PaymentService } from '../modules/payments/paymentService.js';
import { PromotionService } from '../modules/promotions/promotionService.js';
import { InviteService } from '../modules/staging/inviteService.js';
import { StoreService } from '../modules/stores/storeService.js';
import { SupportService } from '../modules/support/supportService.js';
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
  inventory: InventoryService;
  reservations: ReservationService;
  delivery: DeliveryService;
  settlements: SettlementService;
  support: SupportService;
  returns: ReturnService;
  promotions: PromotionService;
  audit: AuditService;
  exports: ExportService;
  notifications: NotificationDispatchService;
  ego: EgoIntegrationService;
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
  const inventory = new InventoryService(db);
  const reservations = new ReservationService(db, inventory);
  const delivery = new DeliveryService(db);
  const settlements = new SettlementService(db);
  const support = new SupportService(db);
  const returns = new ReturnService(db);
  const promotions = new PromotionService(db);
  const audit = new AuditService(db);
  const exports = new ExportService(db);
  const notifications = new NotificationDispatchService(
    db,
    new Map([['memory', new InMemoryProvider()]]),
  );
  const ego = new EgoIntegrationService(db, false, new BlockedEgoNetwork());
  await seedLocalCatalog(db);
  return {
    db,
    sms,
    identity,
    invites,
    stores,
    catalog,
    orders,
    payments,
    inventory,
    reservations,
    delivery,
    settlements,
    support,
    returns,
    promotions,
    audit,
    exports,
    notifications,
    ego,
  };
}
