import type { PGlite } from '@electric-sql/pglite';

import type { BombeeEnv } from '@bombee/config';

import { createTestDatabase } from '../db/migrate.js';
import { AuditService } from '../modules/audit/service.js';
import { CatalogService } from '../modules/catalog/catalogService.js';
import { PricingService } from '../modules/catalog/pricingService.js';
import { ExportService } from '../modules/exports/service.js';
import { DeliveryService } from '../modules/fulfillment/deliveryService.js';
import { ReturnService } from '../modules/fulfillment/returnService.js';
import { RecallService } from '../modules/fulfillment/recallService.js';
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
import { ReportService } from '../modules/reports/reportService.js';
import { BackupService } from '../modules/backup/backupService.js';
import { ImageSearchService } from '../modules/search/imageSearchService.js';
import { CustomerPrivacyService } from '../modules/customers/privacyService.js';
import { ContentService } from '../modules/content/contentService.js';
import { InviteService } from '../modules/staging/inviteService.js';
import { StoreService } from '../modules/stores/storeService.js';
import { QualityService } from '../modules/stores/qualityService.js';
import { ContractService } from '../modules/stores/contractService.js';
import { PayoutService } from '../modules/stores/payoutService.js';
import { NotificationBus } from '../modules/notifications/bus.js';
import { SupportService } from '../modules/support/supportService.js';
import { seedLocalCatalog } from './seedLocalCatalog.js';

export type ApiServices = {
  db: PGlite;
  sms: MockSmsProvider;
  identity: IdentityService;
  invites: InviteService;
  stores: StoreService;
  quality: QualityService;
  contracts: ContractService;
  payouts: PayoutService;
  catalog: CatalogService;
  pricing: PricingService;
  orders: OrderService;
  payments: PaymentService;
  inventory: InventoryService;
  reservations: ReservationService;
  delivery: DeliveryService;
  settlements: SettlementService;
  support: SupportService;
  returns: ReturnService;
  recalls: RecallService;
  promotions: PromotionService;
  audit: AuditService;
  exports: ExportService;
  notifications: NotificationDispatchService;
  ego: EgoIntegrationService;
  reports: ReportService;
  backups: BackupService;
  imageSearch: ImageSearchService;
  privacy: CustomerPrivacyService;
  content: ContentService;
};

/** Local/mock runtime: in-memory PGlite + mock SMS (no hosted DB required). */
export async function createLocalApiServices(_env: BombeeEnv): Promise<ApiServices> {
  const db = await createTestDatabase();
  const sms = new MockSmsProvider();
  const identity = new IdentityService(db, sms);
  const invites = new InviteService(db);
  const stores = new StoreService(db);
  const quality = new QualityService(db);
  const contracts = new ContractService(db);
  const payouts = new PayoutService(db, new NotificationBus());
  const catalog = new CatalogService(db);
  const pricing = new PricingService(db);
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
  const recalls = new RecallService(db, audit);
  const exports = new ExportService(db);
  const notifications = new NotificationDispatchService(
    db,
    new Map([['memory', new InMemoryProvider()]]),
  );
  const ego = new EgoIntegrationService(db, false, new BlockedEgoNetwork());
  const reports = new ReportService(db);
  const backups = new BackupService(db);
  const imageSearch = new ImageSearchService(db);
  const privacy = new CustomerPrivacyService(db, sms, audit);
  const content = new ContentService(db, undefined, audit);
  await seedLocalCatalog(db);
  return {
    db,
    sms,
    identity,
    invites,
    stores,
    quality,
    contracts,
    payouts,
    catalog,
    pricing,
    orders,
    payments,
    inventory,
    reservations,
    delivery,
    settlements,
    support,
    returns,
    recalls,
    promotions,
    audit,
    exports,
    notifications,
    ego,
    reports,
    backups,
    imageSearch,
    privacy,
    content,
  };
}
