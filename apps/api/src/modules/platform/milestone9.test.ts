import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { parseEnv } from '@bombee/config';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { StoreService } from '../stores/storeService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { ReportService } from '../reports/reportService.js';
import {
  InMemoryProvider,
  NotificationDispatchService,
} from '../notifications/dispatchService.js';
import { ImageSearchService, SEARCH_IMAGE_TTL_MS } from '../search/imageSearchService.js';
import {
  BlockedEgoNetwork,
  EgoIntegrationService,
  MockEgoNetwork,
  EGO_MAX_RETRIES,
} from '../integrations/egoService.js';
import { BackupService } from '../backup/backupService.js';

describe('Milestone 9 reports notifications search ego backup', () => {
  let db: PGlite;
  let customerId: string;
  let staffId: string;
  let storeId: string;
  let variantId: string;

  async function activateStore() {
    const stores = new StoreService(db);
    const id = await stores.createStore({ code: 'M9-A', name: 'M9 Store' });
    for (const docType of ['owner_id', 'store_info', 'bank_account', 'contract'] as const) {
      const docId = await stores.uploadDocument({
        storeId: id,
        docType,
        storageKey: `private/${id}/${docType}.pdf`,
        expiresAt: '2027-01-01',
      });
      await stores.verifyDocument(docId, id);
    }
    await stores.addFulfillmentLocation({
      storeId: id,
      name: 'Main',
      addressLine: 'VTE',
      active: true,
    });
    await stores.activateIfReady(id);
    return id;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    customerId = await identity.ensureCustomer('+8562099000001', 'M9 Customer');
    staffId = (await identity.ensureStaff('staff:m9', 'Staff', '+8562089000001')).identityId;
    storeId = await activateStore();
    const catalog = new CatalogService(db);
    const productId = await catalog.createProduct({
      storeId,
      categorySlug: 'general',
      storeProductId: 'SP-M9',
      copy: { lo: { title: 'ນ້ຳດື່ມ' }, en: { title: 'Drinking Water' } },
    });
    variantId = await catalog.createVariant({
      productId,
      storeId,
      sku: 'WATER-1',
      barcode: '8850123456789',
      hasShelfLife: false,
    });
    await catalog.setStatus('products', productId, 'active');
    await catalog.setStatus('product_variants', variantId, 'active');
  });

  afterAll(async () => {
    await db.close();
  });

  it('builds live dashboard KPIs with authz and payment reconcile', async () => {
    const reports = new ReportService(db);
    await expect(
      reports.dashboardKpis({ actorRoles: ['support'] }),
    ).rejects.toThrow('forbidden_ops_report');
    const kpi = await reports.dashboardKpis({ actorRoles: ['owner'] });
    expect(kpi.source).toBe('live');
    expect(kpi.orders).toBeGreaterThanOrEqual(0);
    const recon = await reports.reconcilePayments({ actorRoles: ['finance'] });
    expect(recon.ok).toBe(true);
  });

  it('dispatches notifications with retry/dead-letter and inbox read state', async () => {
    const provider = new InMemoryProvider();
    provider.failTimes = 2;
    const dispatch = new NotificationDispatchService(db, new Map([['memory', provider]]));
    const outboxId = await dispatch.enqueue({
      channel: 'in_app',
      provider: 'memory',
      destination: staffId,
      template: 'test.ping',
      title: 'Hello',
      body: 'World',
      recipientIdentityId: staffId,
      actionLink: '/tickets/1',
    });
    expect(outboxId).toBeTruthy();
    await dispatch.processOutbox();
    let status = await db.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM app.notification_outbox WHERE id = $1`,
      [outboxId],
    );
    expect(status.rows[0]?.status).toBe('failed');
    await dispatch.processOutbox(new Date(Date.now() + 120_000));
    await dispatch.processOutbox(new Date(Date.now() + 240_000));
    status = await db.query<{ status: string }>(
      `SELECT status FROM app.notification_outbox WHERE id = $1`,
      [outboxId],
    );
    expect(status.rows[0]?.status).toBe('sent');
    const inbox = await dispatch.listInbox(staffId);
    expect(inbox[0]?.read).toBe(false);
    await dispatch.markRead(inbox[0]!.id, staffId);
    expect((await dispatch.listInbox(staffId))[0]?.read).toBe(true);
  });

  it('validates search upload consent, barcode/OCR lookup, and 24h purge', async () => {
    const search = new ImageSearchService(db);
    await expect(
      search.upload({
        contentType: 'image/gif',
        byteSize: 100,
        consentSearchOnly: true,
      }),
    ).rejects.toThrow('invalid_content_type');
    await expect(
      search.upload({
        contentType: 'image/jpeg',
        byteSize: 100,
        consentSearchOnly: true,
        consentTrainAnalytics: true,
      }),
    ).rejects.toThrow('train_analytics_consent_forbidden');

    const uploaded = await search.upload({
      customerIdentityId: customerId,
      contentType: 'image/jpeg',
      byteSize: 2048,
      consentSearchOnly: true,
      barcodeValue: '8850123456789',
      ocrText: 'Water',
      now: new Date('2026-09-03T00:00:00.000Z'),
    });
    expect(uploaded.expiresAt).toBe(
      new Date(Date.parse('2026-09-03T00:00:00.000Z') + SEARCH_IMAGE_TTL_MS).toISOString(),
    );
    const byBarcode = await search.searchCatalog({ barcodeValue: '8850123456789' });
    expect(byBarcode[0]?.sku).toBe('WATER-1');
    const byOcr = await search.searchCatalog({ ocrText: 'Water' });
    expect(byOcr.length).toBeGreaterThan(0);

    const purged = await search.purgeExpired(new Date('2026-09-04T01:00:00.000Z'));
    expect(purged.deleted).toBeGreaterThanOrEqual(1);
  });

  it('keeps EGO disabled, mocks flows without network when flag OFF', async () => {
    const env = parseEnv({
      APP_ENV: 'local',
      PUBLIC_API_URL: 'http://127.0.0.1:8787',
      PUBLIC_CUSTOMER_URL: 'http://127.0.0.1:5173',
      PUBLIC_BACKOFFICE_URL: 'http://127.0.0.1:5174',
      EGO_POS_ENABLED: 'false',
    });
    expect(env.EGO_POS_ENABLED).toBe(false);

    const blocked = new BlockedEgoNetwork();
    const ego = new EgoIntegrationService(db, env.EGO_POS_ENABLED, blocked);
    await ego.ensureProfile(storeId);
    const center = await ego.integrationCenterStatus(storeId);
    expect(center.display).toBe('Disabled/Not configured');
    expect(center.featureFlagOn).toBe(false);
    expect(center.credentialsConfigured).toBe(false);

    await ego.setSourceOfTruth(storeId, 'ego');
    const mappingId = await ego.suggestMapping({
      storeId,
      marketplaceVariantId: variantId,
      suggestedExternalId: 'EGO-WATER-1',
    });
    await ego.approveMapping({ mappingId, approverIdentityId: staffId });

    const stock = await ego.ingestFromEgoMock({
      storeId,
      eventType: 'stock',
      externalId: 'EGO-WATER-1',
      payload: { qty: 10 },
      stockObservedAt: new Date(Date.now() - 31 * 60_000),
    });
    expect(stock.orderingDisabled).toBe(true);

    const queued = await ego.enqueueOrderToEgo({
      storeId,
      orderId: crypto.randomUUID(),
      payload: { totalLak: 1000 },
    });
    expect(queued.reason).toBe('flag_off');
    const dispatch = await ego.dispatchOutbox(queued.outboxId);
    expect(dispatch).toMatchObject({ ok: false, reason: 'flag_off' });
    expect(blocked.calls).toHaveLength(0);
    expect(ego.assertNoProductionTraffic()).toEqual({
      egoPosEnabled: false,
      canSendTraffic: false,
    });

    // contract mock path with retries → error queue (still not real network credentials)
    const mockNet = new MockEgoNetwork();
    mockNet.failUntil = EGO_MAX_RETRIES;
    const egoMockOn = new EgoIntegrationService(db, true, mockNet);
    // Phase-1 env forbids flag on; service still used only in isolated contract test.
    const q2 = await egoMockOn.enqueueOrderToEgo({
      storeId,
      orderId: crypto.randomUUID(),
      payload: { totalLak: 2000 },
    });
    const failed = await egoMockOn.dispatchOutbox(q2.outboxId);
    expect(failed).toMatchObject({ ok: false, reason: 'error_queue' });

    await ego.mockOutageDisableOrdering(storeId);
    await ego.mockFullSyncAndReopen(storeId);
    const store = await db.query<{ can_accept_orders: boolean }>(
      `SELECT can_accept_orders FROM app.stores WHERE id = $1`,
      [storeId],
    );
    expect(store.rows[0]?.can_accept_orders).toBe(true);
  });

  it('runs daily/weekly backups, alerts on failure, and restore drill', async () => {
    const backups = new BackupService(db);
    const daily = await backups.runBackup({ jobType: 'daily_critical' });
    expect(daily.status).toBe('completed');
    expect(daily.checksum).toHaveLength(64);
    expect((await backups.verifyChecksum(daily.jobId)).ok).toBe(true);

    const weekly = await backups.runBackup({ jobType: 'weekly_full' });
    expect(weekly.status).toBe('completed');
    const drill = await backups.restoreDrill(weekly.jobId);
    expect(drill.ok).toBe(true);
    expect(drill.evidence.rpoSeconds).toBe(24 * 60 * 60);
    expect(drill.evidence.rtoSeconds).toBeGreaterThanOrEqual(0);

    const failed = await backups.runBackup({ jobType: 'pre_migration', fail: true });
    expect(failed.status).toBe('failed');
    const alerts = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM private.backup_alerts WHERE backup_job_id = $1`,
      [failed.jobId],
    );
    expect(alerts.rows[0]?.n).toBe(1);
  });
});
