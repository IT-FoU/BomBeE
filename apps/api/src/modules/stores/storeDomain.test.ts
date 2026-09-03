import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { NotificationBus } from '../notifications/bus.js';
import { AuditService } from '../audit/service.js';
import { StoreService, canAcceptOrders } from './storeService.js';
import { ContractService } from './contractService.js';
import { PayoutService, PAYOUT_HOLD_MS } from './payoutService.js';
import { QualityService } from './qualityService.js';

describe('Milestone 2 store domain', () => {
  let db: PGlite;
  let stores: StoreService;
  let contracts: ContractService;
  let payouts: PayoutService;
  let quality: QualityService;
  let audit: AuditService;
  let notifications: NotificationBus;
  let financeId: string;
  let ownerId: string;
  let storeId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    financeId = (await identity.ensureStaff('staff:finance-m2', 'Finance', '+8562083000001'))
      .identityId;
    ownerId = (await identity.ensureStaff('staff:owner-m2', 'Owner', '+8562083000002')).identityId;
    notifications = new NotificationBus();
    stores = new StoreService(db);
    contracts = new ContractService(db);
    payouts = new PayoutService(db, notifications);
    quality = new QualityService(db);
    audit = new AuditService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('blocks activation until docs/fulfillment complete and supports signed doc access', async () => {
    storeId = await stores.createStore({ code: 'DEMO01', name: 'Demo Mart' });
    await stores.addContact({
      storeId,
      contactType: 'owner',
      fullName: 'Owner Demo',
      phoneE164: '+8562083000099',
      isPrimary: true,
    });

    const blocked = await stores.activateIfReady(storeId);
    expect(blocked).toEqual({ ok: false, reason: 'onboarding_incomplete' });

    const docs = [
      'owner_id',
      'store_info',
      'bank_account',
      'contract',
    ] as const;
    for (const docType of docs) {
      const id = await stores.uploadDocument({
        storeId,
        docType,
        storageKey: `private/${storeId}/${docType}.pdf`,
        expiresAt: '2027-01-01',
      });
      await stores.verifyDocument(id, storeId);
      if (docType === 'owner_id') {
        await stores.scheduleDocumentExpiryAlerts(id, '2027-01-01');
        const access = await stores.issueSignedAccess({
          storageKey: `private/${storeId}/${docType}.pdf`,
          actorIdentityId: ownerId,
          documentId: id,
          reason: 'onboarding review',
        });
        expect(access.token).toHaveLength(64);
      }
    }

    await expect(
      stores.addFulfillmentLocation({
        storeId,
        name: 'Main',
        addressLine: 'Vientiane',
        active: true,
      }),
    ).resolves.toBeTruthy();

    await expect(
      stores.addFulfillmentLocation({
        storeId,
        name: 'Second',
        addressLine: 'Vientiane 2',
        active: true,
      }),
    ).rejects.toThrow(/phase1_one_active/);

    const ready = await stores.activateIfReady(storeId);
    expect(ready).toEqual({ ok: true });

    const status = await db.query<{ status: string; can_accept_orders: boolean }>(
      `SELECT status, can_accept_orders FROM app.stores WHERE id = $1`,
      [storeId],
    );
    expect(status.rows[0]).toMatchObject({ status: 'active', can_accept_orders: true });
  });

  it('snapshots contract by effective date and rejects retroactive recalculation', async () => {
    const v1 = await contracts.createVersion({
      storeId,
      terms: {
        revenueModel: 'commission',
        commissionBps: 1000,
        settlementCadence: 'weekly',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-06-01T00:00:00.000Z',
      },
      createdBy: ownerId,
    });
    const v2 = await contracts.createVersion({
      storeId,
      terms: {
        revenueModel: 'mixed',
        commissionBps: 800,
        perOrderFeeLak: 5000,
        settlementCadence: 'monthly',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
      },
      createdBy: ownerId,
    });

    const snapOld = await contracts.snapshotForChildOrder({
      childOrderId: crypto.randomUUID(),
      storeId,
      orderCreatedAt: '2026-03-15T12:00:00.000Z',
    });
    expect(snapOld.id).toBe(v1.id);
    expect(snapOld.commissionBps).toBe(1000);

    const snapNew = await contracts.snapshotForChildOrder({
      childOrderId: crypto.randomUUID(),
      storeId,
      orderCreatedAt: '2026-07-01T12:00:00.000Z',
    });
    expect(snapNew.id).toBe(v2.id);
    expect(snapNew.perOrderFeeLak).toBe(5000);

    expect(await contracts.tryMutateContract(v1.id)).toBe(true);
  });

  it('enforces payout maker-checker, 2FA, and 48-hour hold', async () => {
    const first = await payouts.createPendingVersion({
      storeId,
      bankName: 'BCEL',
      accountNumberLast4: '1234',
      accountHolder: 'Demo Mart',
    });
    const req1 = await payouts.requestChange({
      storeId,
      requestedVersionId: first,
      makerIdentityId: financeId,
    });
    const approved1 = await payouts.approveChange({
      requestId: req1,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: true,
      now: 1_000_000,
    });
    expect(approved1.ok).toBe(true);

    const second = await payouts.createPendingVersion({
      storeId,
      bankName: 'LDB',
      accountNumberLast4: '9999',
      accountHolder: 'Demo Mart',
    });
    const req2 = await payouts.requestChange({
      storeId,
      requestedVersionId: second,
      makerIdentityId: financeId,
    });

    expect(
      await payouts.approveChange({
        requestId: req2,
        approverIdentityId: financeId,
        actorRoles: ['finance'],
        stepUpVerified: true,
      }),
    ).toEqual({ ok: false, reason: 'owner_required' });

    expect(
      await payouts.approveChange({
        requestId: req2,
        approverIdentityId: ownerId,
        actorRoles: ['owner'],
        stepUpVerified: false,
      }),
    ).toEqual({ ok: false, reason: '2fa_required' });

    const now = 2_000_000;
    const approved2 = await payouts.approveChange({
      requestId: req2,
      approverIdentityId: ownerId,
      actorRoles: ['owner'],
      stepUpVerified: true,
      now,
    });
    expect(approved2.ok).toBe(true);
    expect(notifications.messages.some((m) => m.template === 'payout.account_changed')).toBe(true);

    const held = await payouts.settlementPayoutVersion(storeId, now + 60_000);
    expect(held).toMatchObject({ ok: false, reason: 'payout_hold_active' });

    const released = await payouts.settlementPayoutVersion(storeId, now + PAYOUT_HOLD_MS + 1);
    expect(released).toMatchObject({ ok: true, versionId: second });
  });

  it('suspends on quality thresholds and keeps catalog visible but not buyable', async () => {
    for (let i = 0; i < 5; i += 1) {
      await quality.recordEvent({ storeId, eventType: 'slow_response_or_pack' });
    }
    const store = await db.query<{
      status: string;
      can_accept_orders: boolean;
      products_visible: boolean;
      existing_orders_under_review: boolean;
    }>(
      `SELECT status, can_accept_orders, products_visible, existing_orders_under_review
       FROM app.stores WHERE id = $1`,
      [storeId],
    );
    expect(store.rows[0]).toMatchObject({
      status: 'suspended',
      can_accept_orders: false,
      products_visible: true,
      existing_orders_under_review: true,
    });
    expect(canAcceptOrders('suspended', false)).toBe(false);

    await audit.append({
      actorIdentityId: ownerId,
      actorType: 'staff',
      action: 'store.suspend',
      targetType: 'store',
      targetId: storeId,
      reason: 'slow_response_or_pack threshold',
      correlationId: crypto.randomUUID(),
    });

    const reactivated = await quality.reactivate({
      storeId,
      actorIdentityId: ownerId,
      actorRoles: ['owner'],
      correctiveActionEvidence: 'hired packer and retrained',
    });
    expect(reactivated).toEqual({ ok: true });

    await audit.append({
      actorIdentityId: ownerId,
      actorType: 'staff',
      action: 'store.reactivate',
      targetType: 'store',
      targetId: storeId,
      reason: 'corrective action complete',
      correlationId: crypto.randomUUID(),
    });

    const fraud = await quality.recordEvent({ storeId, eventType: 'fraud_or_security' });
    expect(fraud.suspended).toBe(true);
  });

  it('auto-suspends when required documents expire', async () => {
    const freshStore = await stores.createStore({ code: 'DEMO02', name: 'Expiry Mart' });
    const docId = await stores.uploadDocument({
      storeId: freshStore,
      docType: 'owner_id',
      storageKey: `private/${freshStore}/owner_id.pdf`,
      expiresAt: '2026-01-01',
    });
    await stores.verifyDocument(docId, freshStore);
    await stores.suspendForExpiredDocuments(freshStore, ownerId);
    const row = await db.query<{ status: string; can_accept_orders: boolean }>(
      `SELECT status, can_accept_orders FROM app.stores WHERE id = $1`,
      [freshStore],
    );
    expect(row.rows[0]).toMatchObject({ status: 'suspended', can_accept_orders: false });
  });
});
