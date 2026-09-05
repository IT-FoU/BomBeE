import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME, CURRENCY_CODE, DISPLAY_TIMEZONE } from '@bombee/shared';

import { readJsonBody } from './http/readJsonBody.js';
import { applyCors } from './http/cors.js';
import { mockAdvanceFulfillment, mockDeliverFulfillment } from './modules/fulfillment/mockAdvance.js';
import { cancelOrderBeforeHandoff } from './modules/orders/cancelBeforeHandoff.js';
import { mockExpireDue } from './modules/payments/mockExpireDue.js';
import { getHealth } from './modules/system/health.js';
import { listRoleCatalog } from './modules/rbac/permissions.js';
import type { BackupType } from './modules/backup/backupService.js';
import type { ApiServices } from './runtime/createServices.js';
import { evaluateInviteAccess, type InviteRole } from './modules/staging/inviteService.js';

export function createAppRouter(env: BombeeEnv, services: ApiServices) {
  return async function appRouter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const preflight = applyCors(env, req, res);
    if (preflight.handledPreflight) return;

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, getHealth(env));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/capabilities') {
      sendJson(res, 200, {
        smsProvider:
          env.INTEGRATIONS_MODE === 'mock'
            ? 'mock'
            : env.INTEGRATIONS_MODE === 'sandbox'
              ? 'sandbox'
              : 'external',
        backofficeIdleSeconds: 3600,
        maxFailedLogins: 5,
        egoPosEnabled: env.EGO_POS_ENABLED,
        inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
        integrationsMode: env.INTEGRATIONS_MODE,
        auditRetentionYears: 5,
        productionDeployAuthorized: env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        productionHold: !env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        otpHttpEnabled: true,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/otp/request') {
      const body = await readJsonBody<{
        phoneE164?: string;
        purpose?: string;
        inviteCode?: string;
      }>(req);
      const phoneE164 = body.phoneE164?.trim();
      if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
        sendJson(res, 400, { error: 'invalid_phone' });
        return;
      }

      if (env.INVITE_ONLY_ENABLED) {
        const inviteCode = body.inviteCode?.trim();
        if (!inviteCode) {
          sendJson(res, 403, { error: 'invite_required' });
          return;
        }
        const invite = await services.invites.findByCode(inviteCode);
        const access = evaluateInviteAccess({
          inviteOnlyEnabled: true,
          invite,
        });
        if (!access.allowed) {
          sendJson(res, 403, { error: access.reason });
          return;
        }
      }

      const purpose = body.purpose === 'staff_login' ? 'staff_login' : 'customer_login';
      if (purpose === 'customer_login') {
        await services.identity.ensureCustomer(phoneE164, `Customer ${phoneE164.slice(-4)}`);
      }
      const correlationId = crypto.randomUUID();
      const result = await services.identity.requestOtp({
        phoneE164,
        purpose,
        correlationId,
      });
      const payload: Record<string, unknown> = { ...result };
      // Local/mock only — never expose OTP codes outside local APP_ENV
      if (env.APP_ENV === 'local' && env.INTEGRATIONS_MODE === 'mock') {
        const last = services.sms.sent.at(-1);
        if (last && last.phoneE164 === phoneE164) {
          payload.devCode = last.code;
        }
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/otp/verify') {
      const body = await readJsonBody<{
        phoneE164?: string;
        code?: string;
        purpose?: string;
        inviteCode?: string;
      }>(req);
      const phoneE164 = body.phoneE164?.trim();
      const code = body.code?.trim();
      if (!phoneE164 || !code) {
        sendJson(res, 400, { error: 'invalid_request' });
        return;
      }
      const purpose = body.purpose === 'staff_login' ? 'staff_login' : 'customer_login';
      const verified = await services.identity.verifyOtp({ phoneE164, purpose, code });
      if (!verified.ok) {
        sendJson(res, 401, { error: verified.reason });
        return;
      }
      const identityId =
        purpose === 'customer_login'
          ? await services.identity.ensureCustomer(phoneE164, `Customer ${phoneE164.slice(-4)}`)
          : (
              await services.db.query<{ id: string }>(
                `SELECT id FROM security.auth_identities WHERE phone_e164 = $1 LIMIT 1`,
                [phoneE164],
              )
            ).rows[0]?.id;
      if (!identityId) {
        sendJson(res, 401, { error: 'identity_missing' });
        return;
      }

      const inviteCode = body.inviteCode?.trim();
      if (env.INVITE_ONLY_ENABLED || inviteCode) {
        if (!inviteCode) {
          sendJson(res, 403, { error: 'invite_required' });
          return;
        }
        const redeemed = await services.invites.redeem({
          inviteCode,
          inviteOnlyEnabled: env.INVITE_ONLY_ENABLED || Boolean(inviteCode),
          identityId,
          phoneE164,
        });
        if (!redeemed.allowed) {
          sendJson(res, 403, { error: redeemed.reason });
          return;
        }
      }

      const sessionId = await services.identity.createSession({
        authIdentityId: identityId,
        audience: purpose === 'staff_login' ? 'backoffice' : 'customer',
        ttlMs: 7 * 24 * 60 * 60_000,
      });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
      sendJson(res, 200, {
        ok: true,
        sessionToken: sessionId,
        expiresAt,
        identityId,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
      if (!token) {
        sendJson(res, 401, { error: 'missing_token' });
        return;
      }
      const session = await services.identity.getSession(token);
      if (!session) {
        sendJson(res, 401, { error: 'invalid_session' });
        return;
      }
      sendJson(res, 200, { ok: true, ...session });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
      const body = await readJsonBody<{ sessionToken?: string }>(req);
      const auth = req.headers.authorization ?? '';
      const token =
        body.sessionToken?.trim() ||
        (auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '');
      if (!token) {
        sendJson(res, 400, { error: 'missing_token' });
        return;
      }
      await services.identity.revokeSession(token, 'logout');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/invites') {
      const rows = await services.invites.listInvites();
      sendJson(res, 200, { ok: true, invites: rows });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/invites') {
      const body = await readJsonBody<{
        inviteCode?: string;
        intendedRole?: InviteRole;
        maxUses?: number;
        note?: string;
        phoneE164?: string;
      }>(req);
      const inviteCode = body.inviteCode?.trim().toUpperCase();
      if (!inviteCode || !/^[A-Z0-9-]{4,32}$/.test(inviteCode)) {
        sendJson(res, 400, { error: 'invalid_invite_code' });
        return;
      }
      const role = body.intendedRole ?? 'customer';
      if (!['customer', 'store_owner', 'ops', 'admin'].includes(role)) {
        sendJson(res, 400, { error: 'invalid_role' });
        return;
      }
      try {
        const invite = await services.invites.createInvite({
          inviteCode,
          intendedRole: role,
          maxUses: body.maxUses && body.maxUses > 0 ? Math.min(body.maxUses, 100) : 1,
          note: body.note?.trim() || null,
          phoneE164: body.phoneE164?.trim() || null,
        });
        sendJson(res, 201, { ok: true, invite });
      } catch {
        sendJson(res, 409, { error: 'invite_code_taken' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores') {
      const rows = await services.stores.listStores();
      sendJson(res, 200, { ok: true, stores: rows });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores/contracts') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const storeId = url.searchParams.get('storeId')?.trim() || undefined;
      const contracts = await services.contracts.listVersions({ storeId, limit });
      sendJson(res, 200, { ok: true, contracts });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores/documents') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const storeId = url.searchParams.get('storeId')?.trim() || undefined;
      const documents = await services.stores.listDocuments({ storeId, limit });
      sendJson(res, 200, { ok: true, documents });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores/document-expiry-alerts') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const filterRaw = url.searchParams.get('filter')?.trim() || 'all';
      const filter =
        filterRaw === 'due' || filterRaw === 'expired' ? filterRaw : 'all';
      const alerts = await services.stores.listDocumentExpiryAlerts(limit, filter);
      sendJson(res, 200, { ok: true, alerts });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/stores/documents/mock-evaluate-expiry') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        documentId?: string;
        document_id?: string;
        today?: string;
        expiresAt?: string;
        expires_at?: string;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        let documentId = (body.documentId ?? body.document_id)?.trim();
        const today =
          body.today?.trim() || new Date().toISOString().slice(0, 10);
        const expiresAt =
          body.expiresAt?.trim() ||
          body.expires_at?.trim() ||
          new Date(Date.parse(`${today}T00:00:00.000Z`) - 24 * 60 * 60_000)
            .toISOString()
            .slice(0, 10);

        if (documentId) {
          const doc = await services.db.query<{
            store_id: string;
            status: string;
          }>(`SELECT store_id, status FROM private.store_documents WHERE id = $1`, [
            documentId,
          ]);
          if (!doc.rows[0]) {
            sendJson(res, 404, { error: 'document_not_found' });
            return;
          }
          storeId = doc.rows[0].store_id;
          await services.db.query(
            `UPDATE private.store_documents SET expires_at = $2::date WHERE id = $1`,
            [documentId, expiresAt],
          );
          if (doc.rows[0].status !== 'verified') {
            await services.stores.verifyDocument(documentId, storeId);
          }
        } else {
          if (!storeId) {
            const existing = await services.db.query<{ id: string }>(
              `SELECT id FROM app.stores ORDER BY created_at DESC LIMIT 1`,
            );
            storeId = existing.rows[0]?.id;
          }
          if (!storeId) {
            storeId = await services.stores.createStore({
              code: `EXP${Date.now().toString().slice(-6)}`,
              name: 'Doc Expiry QA Mart',
            });
          }
          documentId = await services.stores.uploadDocument({
            storeId,
            docType: 'owner_id',
            storageKey: `private/${storeId}/owner_id-expiry-${crypto.randomUUID().slice(0, 8)}.pdf`,
            expiresAt,
          });
          await services.stores.verifyDocument(documentId, storeId);
          await services.stores.scheduleDocumentExpiryAlerts(documentId, expiresAt);
        }

        const actorIdentityId = await resolveOpsActor(services);
        const evaluated = await services.stores.evaluateExpiredDocuments({
          today,
          storeId,
          actorIdentityId,
        });
        const alerts = await services.stores.listDocumentExpiryAlerts(50);
        const store = await services.db.query<{
          id: string;
          status: string;
          can_accept_orders: boolean;
        }>(`SELECT id, status, can_accept_orders FROM app.stores WHERE id = $1`, [storeId]);
        sendJson(res, 200, {
          ok: true,
          ...evaluated,
          storeId,
          documentId,
          expiresAt,
          storeStatus: store.rows[0]?.status,
          canAcceptOrders: store.rows[0]?.can_accept_orders,
          alerts,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'doc_expiry_evaluate_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeOnboardingMatch = url.pathname.match(/^\/v1\/stores\/([^/]+)\/onboarding$/);
    if (req.method === 'GET' && storeOnboardingMatch) {
      const storeId = decodeURIComponent(storeOnboardingMatch[1]!);
      const onboarding = await services.stores.getOnboarding(storeId);
      if (!onboarding) {
        sendJson(res, 404, { error: 'store_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, ...onboarding });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/stores/contracts/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        revenueModel?: 'markup' | 'commission' | 'per_order_fee' | 'mixed';
        revenue_model?: 'markup' | 'commission' | 'per_order_fee' | 'mixed';
        commissionBps?: number;
        commission_bps?: number;
        settlementCadence?: 'daily' | 'weekly' | 'monthly' | 'custom';
        settlement_cadence?: 'daily' | 'weekly' | 'monthly' | 'custom';
        effectiveFrom?: string;
        effective_from?: string;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const store = await services.db.query<{ id: string }>(
            `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          storeId = store.rows[0]?.id;
        }
        if (!storeId) {
          sendJson(res, 409, { error: 'no_active_store' });
          return;
        }
        const actorIdentityId = await resolveOpsActor(services);
        const created = await services.contracts.createVersion({
          storeId,
          createdBy: actorIdentityId,
          terms: {
            revenueModel: body.revenueModel ?? body.revenue_model ?? 'commission',
            commissionBps:
              typeof body.commissionBps === 'number'
                ? body.commissionBps
                : typeof body.commission_bps === 'number'
                  ? body.commission_bps
                  : 1000,
            settlementCadence:
              body.settlementCadence ?? body.settlement_cadence ?? 'weekly',
            effectiveFrom:
              body.effectiveFrom ??
              body.effective_from ??
              new Date().toISOString().slice(0, 10),
          },
        });
        const contracts = await services.contracts.listVersions({ limit: 50 });
        sendJson(res, 201, { ok: true, ...created, storeId, contracts });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'contract_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/payouts/requests') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const [requests, accounts] = await Promise.all([
        services.payouts.listChangeRequests(limit),
        services.payouts.listAccounts({ limit }),
      ]);
      sendJson(res, 200, { ok: true, requests, accounts });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/payouts/mock-propose') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        bankName?: string;
        bank_name?: string;
        accountNumberLast4?: string;
        account_number_last4?: string;
        accountHolder?: string;
        account_holder?: string;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const store = await services.db.query<{ id: string }>(
            `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          storeId = store.rows[0]?.id;
        }
        if (!storeId) {
          sendJson(res, 409, { error: 'no_active_store' });
          return;
        }
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const versionId = await services.payouts.createPendingVersion({
          storeId,
          bankName: body.bankName ?? body.bank_name ?? 'BCEL',
          accountNumberLast4:
            body.accountNumberLast4 ??
            body.account_number_last4 ??
            String(Date.now()).slice(-4),
          accountHolder:
            body.accountHolder ?? body.account_holder ?? 'Local Mock Account',
        });
        const requestId = await services.payouts.requestChange({
          storeId,
          requestedVersionId: versionId,
          makerIdentityId: maker.identityId,
        });
        const [requests, accounts] = await Promise.all([
          services.payouts.listChangeRequests(50),
          services.payouts.listAccounts({ limit: 50 }),
        ]);
        sendJson(res, 201, {
          ok: true,
          requestId,
          versionId,
          storeId,
          status: 'pending',
          requests,
          accounts,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'payout_propose_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const payoutApproveMatch = url.pathname.match(/^\/v1\/ops\/payouts\/([^/]+)\/approve$/);
    if (req.method === 'POST' && payoutApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const requestId = decodeURIComponent(payoutApproveMatch[1]!);
      const body = await readJsonBody<{
        stepUpVerified?: boolean;
        step_up_verified?: boolean;
      }>(req);
      try {
        const reqRow = await services.db.query<{
          maker_identity_id: string;
          status: string;
        }>(
          `SELECT maker_identity_id, status FROM finance.payout_change_requests WHERE id = $1`,
          [requestId],
        );
        if (!reqRow.rows[0]) {
          sendJson(res, 404, { error: 'payout_request_not_found' });
          return;
        }
        if (reqRow.rows[0].status !== 'pending') {
          sendJson(res, 409, { error: 'not_pending' });
          return;
        }
        const makerIdentityId = reqRow.rows[0].maker_identity_id;
        const owner = await services.identity.ensureStaff(
          'staff:local-catalog-owner',
          'Catalog Owner',
          '+8562087000002',
        );
        if (owner.identityId === makerIdentityId) {
          sendJson(res, 409, { error: 'self_approval' });
          return;
        }
        const stepUpVerified = body.stepUpVerified ?? body.step_up_verified ?? true;
        const approved = await services.payouts.approveChange({
          requestId,
          approverIdentityId: owner.identityId,
          actorRoles: ['owner'],
          stepUpVerified,
        });
        if (!approved.ok) {
          const status =
            approved.reason === 'not_found'
              ? 404
              : approved.reason === 'not_pending' || approved.reason === 'self_approval'
                ? 409
                : approved.reason === 'owner_required' || approved.reason === '2fa_required'
                  ? 403
                  : 400;
          sendJson(res, status, { error: approved.reason });
          return;
        }
        const [requests, accounts] = await Promise.all([
          services.payouts.listChangeRequests(50),
          services.payouts.listAccounts({ limit: 50 }),
        ]);
        sendJson(res, 200, {
          ok: true,
          requestId,
          status: 'approved',
          holdUntil: approved.holdUntil,
          requests,
          accounts,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'payout_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/cod/shipments') {
      const rows = await services.db.query<{
        id: string;
        child_order_id: string;
        parent_order_id: string;
        status: string;
        amount_lak: number;
        deposit_lak: number;
        balance_due_lak: number;
        created_at: string;
      }>(
        `SELECT cs.id, cs.child_order_id, co.parent_order_id, cs.status,
                cs.amount_lak, cs.deposit_lak, cs.balance_due_lak, cs.created_at::text
         FROM finance.cod_shipments cs
         JOIN app.child_orders co ON co.id = cs.child_order_id
         ORDER BY cs.created_at DESC
         LIMIT 100`,
      );
      sendJson(res, 200, {
        ok: true,
        shipments: rows.rows.map((r) => ({
          codShipmentId: r.id,
          childOrderId: r.child_order_id,
          parentOrderId: r.parent_order_id,
          status: r.status,
          amountLak: Number(r.amount_lak),
          depositLak: Number(r.deposit_lak),
          balanceDueLak: Number(r.balance_due_lak),
          createdAt: r.created_at,
        })),
      });
      return;
    }

    const mockRemitMatch = url.pathname.match(/^\/v1\/cod\/shipments\/([^/]+)\/mock-remit$/);
    if (req.method === 'POST' && mockRemitMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const codShipmentId = decodeURIComponent(mockRemitMatch[1]!);
      const body = await readJsonBody<{ courierRef?: string; amountLak?: number }>(req);
      const row = await services.db.query<{
        id: string;
        status: string;
        balance_due_lak: number;
      }>(
        `SELECT id, status, balance_due_lak FROM finance.cod_shipments WHERE id = $1`,
        [codShipmentId],
      );
      const shipment = row.rows[0];
      if (!shipment) {
        sendJson(res, 404, { error: 'cod_shipment_not_found' });
        return;
      }
      if (shipment.status === 'failed') {
        sendJson(res, 409, { error: 'cod_shipment_failed' });
        return;
      }
      const amountLak =
        body.amountLak !== undefined ? Number(body.amountLak) : Number(shipment.balance_due_lak);
      if (!Number.isInteger(amountLak) || amountLak < 0) {
        sendJson(res, 400, { error: 'invalid_amount' });
        return;
      }

      let remittanceId: string | undefined;
      if (shipment.status === 'remitted') {
        const existing = await services.db.query<{ remittance_id: string }>(
          `SELECT remittance_id FROM finance.cod_remittance_links
           WHERE cod_shipment_id = $1 ORDER BY remittance_id LIMIT 1`,
          [codShipmentId],
        );
        remittanceId = existing.rows[0]?.remittance_id;
      } else {
        remittanceId = await services.payments.recordCourierRemittance({
          courierRef: body.courierRef?.trim() || `MOCK-REM-${Date.now()}`,
          amountLak,
          codShipmentId,
        });
      }
      const reconcile = await services.payments.reconcileCod(codShipmentId);
      sendJson(res, 200, {
        ok: true,
        codShipmentId,
        remittanceId,
        status: 'remitted',
        amountLak,
        reconcile,
        idempotentReplay: shipment.status === 'remitted',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/cod/profiles') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const profiles = await services.payments.listCodProfiles(limit);
      sendJson(res, 200, { ok: true, profiles });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/cod/redelivery-fees') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const fees = await services.payments.listRedeliveryFees(limit);
      sendJson(res, 200, { ok: true, fees });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/cod/profiles/mock-failure') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        customerIdentityId?: string;
        customer_identity_id?: string;
        customerCaused?: boolean;
        customer_caused?: boolean;
      }>(req);
      try {
        let customerIdentityId = (body.customerIdentityId ?? body.customer_identity_id)?.trim();
        if (!customerIdentityId) {
          const existing = await services.db.query<{ customer_identity_id: string }>(
            `SELECT customer_identity_id FROM finance.cod_profiles
             ORDER BY updated_at DESC LIMIT 1`,
          );
          customerIdentityId = existing.rows[0]?.customer_identity_id;
        }
        if (!customerIdentityId) {
          customerIdentityId = await services.identity.ensureCustomer(
            '+8562097008861',
            'Local COD Failure Customer',
          );
        }
        const customerCaused = body.customerCaused ?? body.customer_caused ?? true;
        const result = await services.payments.recordCustomerCodFailure(
          customerIdentityId,
          customerCaused,
        );
        const profiles = await services.payments.listCodProfiles(50);
        sendJson(res, 200, {
          ok: true,
          customerIdentityId,
          customerCaused,
          ...result,
          profiles,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'cod_failure_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const codRestoreMatch = url.pathname.match(
      /^\/v1\/ops\/cod\/profiles\/([^/]+)\/restore$/,
    );
    if (req.method === 'POST' && codRestoreMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const customerIdentityId = decodeURIComponent(codRestoreMatch[1]!);
      const body = await readJsonBody<{ reason?: string }>(req);
      try {
        const actorIdentityId = await resolveOpsActor(services);
        await services.payments.restoreCod({
          customerIdentityId,
          actorIdentityId,
          reason: body.reason?.trim() || 'local_mock_cod_restore',
        });
        const profiles = await services.payments.listCodProfiles(50);
        sendJson(res, 200, {
          ok: true,
          customerIdentityId,
          qrForced: false,
          failedCodCount: 0,
          profiles,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'cod_restore_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/cod/redelivery-fees/mock-require') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        childOrderId?: string;
        child_order_id?: string;
        amountLak?: number;
        amount_lak?: number;
      }>(req);
      try {
        let childOrderId = (body.childOrderId ?? body.child_order_id)?.trim();
        if (!childOrderId) {
          const child = await services.db.query<{ id: string }>(
            `SELECT id FROM app.child_orders ORDER BY created_at DESC LIMIT 1`,
          );
          childOrderId = child.rows[0]?.id;
        }
        if (!childOrderId) {
          sendJson(res, 409, { error: 'no_eligible_child' });
          return;
        }
        const amountLak =
          typeof body.amountLak === 'number'
            ? Math.trunc(body.amountLak)
            : typeof body.amount_lak === 'number'
              ? Math.trunc(body.amount_lak)
              : 15_000;
        if (!Number.isInteger(amountLak) || amountLak <= 0) {
          sendJson(res, 400, { error: 'invalid_amount' });
          return;
        }
        const redeliveryFeeId = await services.payments.requireRedeliveryFee(
          childOrderId,
          amountLak,
        );
        const fees = await services.payments.listRedeliveryFees(50);
        sendJson(res, 201, {
          ok: true,
          redeliveryFeeId,
          childOrderId,
          amountLak,
          fees,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'redelivery_fee_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/stores') {
      const body = await readJsonBody<{ name?: string; code?: string }>(req);
      const name = body.name?.trim();
      if (!name || name.length < 2) {
        sendJson(res, 400, { error: 'invalid_store_name' });
        return;
      }
      const code =
        body.code?.trim().toUpperCase() ||
        `${name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '')
          .slice(0, 8) || 'STORE'}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
        sendJson(res, 400, { error: 'invalid_store_code' });
        return;
      }
      try {
        const storeId = await services.stores.createStore({ code, name });
        sendJson(res, 201, { ok: true, store: { id: storeId, code, name, status: 'onboarding' } });
      } catch {
        sendJson(res, 409, { error: 'store_code_taken' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/categories') {
      const categories = await services.catalog.listCategories();
      sendJson(res, 200, { ok: true, categories });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/products') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
      const products = await services.catalog.listActiveProducts(limit);
      const withStock = [];
      for (const product of products) {
        const primary = product.variants[0];
        const availableQty = primary
          ? await services.inventory.availableQtyForVariant(primary.id)
          : 0;
        withStock.push({ ...product, availableQty });
      }
      sendJson(res, 200, { ok: true, products: withStock });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/ops/catalog/products') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
      const statusRaw = url.searchParams.get('status')?.trim() || 'all';
      const allowed = [
        'all',
        'draft',
        'pending_approval',
        'active',
        'paused',
        'archived',
      ] as const;
      if (!(allowed as readonly string[]).includes(statusRaw)) {
        sendJson(res, 400, { error: 'invalid_status_filter' });
        return;
      }
      const products = await services.catalog.listOpsProducts(
        limit,
        statusRaw as (typeof allowed)[number],
      );
      sendJson(res, 200, { ok: true, products });
      return;
    }

    const catalogProductStatusMatch = url.pathname.match(
      /^\/v1\/ops\/catalog\/products\/([^/]+)\/status$/,
    );
    if (req.method === 'POST' && catalogProductStatusMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const productId = decodeURIComponent(catalogProductStatusMatch[1]!);
      const body = await readJsonBody<{ status?: string }>(req);
      const status = body.status?.trim();
      const allowed = ['draft', 'pending_approval', 'active', 'paused', 'archived'] as const;
      if (!status || !(allowed as readonly string[]).includes(status)) {
        sendJson(res, 400, { error: 'invalid_status' });
        return;
      }
      try {
        const updated = await services.catalog.setStatus(
          'products',
          productId,
          status as (typeof allowed)[number],
        );
        const products = await services.catalog.listOpsProducts(50);
        sendJson(res, 200, { ok: true, ...updated, table: 'products', products });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'catalog_status_failed';
        sendJson(res, message === 'product_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    const catalogVariantStatusMatch = url.pathname.match(
      /^\/v1\/ops\/catalog\/variants\/([^/]+)\/status$/,
    );
    if (req.method === 'POST' && catalogVariantStatusMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const variantId = decodeURIComponent(catalogVariantStatusMatch[1]!);
      const body = await readJsonBody<{ status?: string }>(req);
      const status = body.status?.trim();
      const allowed = ['draft', 'pending_approval', 'active', 'paused', 'archived'] as const;
      if (!status || !(allowed as readonly string[]).includes(status)) {
        sendJson(res, 400, { error: 'invalid_status' });
        return;
      }
      try {
        const updated = await services.catalog.setStatus(
          'product_variants',
          variantId,
          status as (typeof allowed)[number],
        );
        const products = await services.catalog.listOpsProducts(50);
        sendJson(res, 200, { ok: true, ...updated, table: 'product_variants', products });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'catalog_status_failed';
        sendJson(res, message === 'variant_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/import/batches') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const batches = await services.catalog.listImportBatches(limit);
      sendJson(res, 200, { ok: true, batches });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/catalog/import/preview') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        idempotencyKey?: string;
        idempotency_key?: string;
        rows?: Array<{
          storeProductId?: string;
          store_product_id?: string;
          sku?: string;
          barcode?: string;
          titleLo?: string;
          title_lo?: string;
          titleEn?: string;
          title_en?: string;
          categorySlug?: string;
          category_slug?: string;
          costLak?: number;
          cost_lak?: number;
          sellingPriceLak?: number;
          selling_price_lak?: number;
        }>;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const store = await services.db.query<{ id: string }>(
            `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          storeId = store.rows[0]?.id;
        }
        if (!storeId) {
          sendJson(res, 409, { error: 'no_active_store' });
          return;
        }
        const rawRows = Array.isArray(body.rows) ? body.rows : [];
        const rows =
          rawRows.length > 0
            ? rawRows.map((r) => ({
                storeProductId: String(r.storeProductId ?? r.store_product_id ?? ''),
                sku: String(r.sku ?? ''),
                barcode: r.barcode,
                titleLo: String(r.titleLo ?? r.title_lo ?? ''),
                titleEn: String(r.titleEn ?? r.title_en ?? ''),
                categorySlug: String(r.categorySlug ?? r.category_slug ?? 'general'),
                costLak: Math.floor(Number(r.costLak ?? r.cost_lak ?? 0)),
                sellingPriceLak: Math.floor(
                  Number(r.sellingPriceLak ?? r.selling_price_lak ?? 0),
                ),
              }))
            : [
                {
                  storeProductId: `IMP-${Date.now().toString().slice(-6)}`,
                  sku: `SKU-${Date.now().toString().slice(-6)}`,
                  titleLo: 'ສິນຄ້າທົດສອບ',
                  titleEn: 'Import QA Item',
                  categorySlug: 'general',
                  costLak: 2000,
                  sellingPriceLak: 3500,
                },
              ];
        const idempotencyKey =
          (body.idempotencyKey ?? body.idempotency_key)?.trim() ||
          `local-import-${Date.now()}`;
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const preview = await services.catalog.previewImport({
          storeId,
          idempotencyKey,
          rows,
          createdBy: maker.identityId,
        });
        const batches = await services.catalog.listImportBatches(50);
        sendJson(res, 201, { ok: true, ...preview, storeId, batches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'catalog_import_preview_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const catalogImportCommitMatch = url.pathname.match(
      /^\/v1\/ops\/catalog\/import\/([^/]+)\/commit$/,
    );
    if (req.method === 'POST' && catalogImportCommitMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(catalogImportCommitMatch[1]!);
      try {
        const committed = await services.catalog.commitImport(batchId);
        const batches = await services.catalog.listImportBatches(50);
        if (!committed.ok) {
          sendJson(res, 409, {
            ok: false,
            error: committed.reason,
            batchId,
            batches,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          batchId,
          replay: committed.replay,
          status: 'committed',
          batches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'catalog_import_commit_failed';
        sendJson(res, message === 'batch_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    const catalogImportRollbackMatch = url.pathname.match(
      /^\/v1\/ops\/catalog\/import\/([^/]+)\/rollback$/,
    );
    if (req.method === 'POST' && catalogImportRollbackMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(catalogImportRollbackMatch[1]!);
      try {
        const rolled = await services.catalog.rollbackImport(batchId);
        const batches = await services.catalog.listImportBatches(50);
        sendJson(res, 200, { ok: true, ...rolled, batches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'catalog_import_rollback_failed';
        const status =
          message === 'batch_not_found'
            ? 404
            : message === 'cannot_rollback_committed'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog/media') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const productId = url.searchParams.get('productId')?.trim() || undefined;
      const variantId = url.searchParams.get('variantId')?.trim() || undefined;
      const media = await services.media.listMedia({ productId, variantId, limit });
      sendJson(res, 200, { ok: true, media });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/catalog/media/mock-upload') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        productId?: string;
        product_id?: string;
        variantId?: string;
        variant_id?: string;
        mediaType?: 'image' | 'video';
        media_type?: 'image' | 'video';
        mimeType?: string;
        mime_type?: string;
        byteSize?: number;
        byte_size?: number;
        durationSeconds?: number;
        duration_seconds?: number;
        widthPx?: number;
        width_px?: number;
        heightPx?: number;
        height_px?: number;
      }>(req);
      try {
        let productId = (body.productId ?? body.product_id)?.trim() || undefined;
        const variantId = (body.variantId ?? body.variant_id)?.trim() || undefined;
        if (!productId && !variantId) {
          const product = await services.db.query<{ id: string }>(
            `SELECT id FROM app.products WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          productId = product.rows[0]?.id;
        }
        if (!productId && !variantId) {
          sendJson(res, 409, { error: 'no_product' });
          return;
        }
        const mediaType = body.mediaType ?? body.media_type ?? 'image';
        const mimeType =
          body.mimeType ??
          body.mime_type ??
          (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
        const byteSize =
          typeof body.byteSize === 'number'
            ? Math.floor(body.byteSize)
            : typeof body.byte_size === 'number'
              ? Math.floor(body.byte_size)
              : mediaType === 'video'
                ? 1_000_000
                : 120_000;
        const durationSeconds =
          typeof body.durationSeconds === 'number'
            ? body.durationSeconds
            : typeof body.duration_seconds === 'number'
              ? body.duration_seconds
              : mediaType === 'video'
                ? 30
                : undefined;
        const widthPx =
          typeof body.widthPx === 'number'
            ? body.widthPx
            : typeof body.width_px === 'number'
              ? body.width_px
              : mediaType === 'image'
                ? 800
                : undefined;
        const heightPx =
          typeof body.heightPx === 'number'
            ? body.heightPx
            : typeof body.height_px === 'number'
              ? body.height_px
              : mediaType === 'image'
                ? 800
                : undefined;
        const uploaded = await services.media.upload({
          productId,
          variantId,
          mediaType,
          mimeType,
          byteSize,
          durationSeconds,
          widthPx,
          heightPx,
        });
        const media = await services.media.listMedia({ limit: 50 });
        sendJson(res, 201, {
          ok: true,
          mediaId: uploaded.id,
          storageKey: uploaded.storageKey,
          thumbnailKey: uploaded.thumbnailKey,
          productId: productId ?? null,
          variantId: variantId ?? null,
          mediaType,
          validationStatus: 'passed',
          media,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'media_upload_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const mediaSignedMatch = url.pathname.match(
      /^\/v1\/ops\/catalog\/media\/([^/]+)\/signed-url$/,
    );
    if (req.method === 'POST' && mediaSignedMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const mediaId = decodeURIComponent(mediaSignedMatch[1]!);
      const body = await readJsonBody<{
        ttlMs?: number;
        ttl_ms?: number;
      }>(req);
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const access = await services.media.issueSignedUrl({
          mediaId,
          actorIdentityId,
          ttlMs:
            typeof body.ttlMs === 'number'
              ? body.ttlMs
              : typeof body.ttl_ms === 'number'
                ? body.ttl_ms
                : undefined,
        });
        sendJson(res, 200, {
          ok: true,
          mediaId,
          token: access.token,
          expiresAt: access.expiresAt,
          storageKey: access.storageKey,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'media_signed_url_failed';
        const status =
          message === 'media_not_found' ? 404 : message === 'media_not_available' ? 409 : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/inventory/stock') {
      const variantId = url.searchParams.get('variantId')?.trim();
      if (!variantId) {
        sendJson(res, 400, { error: 'variant_id_required' });
        return;
      }
      const stock = await services.inventory.listStockByVariant(variantId);
      sendJson(res, 200, { ok: true, ...stock });
      return;
    }

    const inventoryReconcileMatch = url.pathname.match(
      /^\/v1\/inventory\/balances\/([^/]+)\/reconcile$/,
    );
    if (req.method === 'GET' && inventoryReconcileMatch) {
      const balanceId = decodeURIComponent(inventoryReconcileMatch[1]!);
      try {
        const report = await services.inventory.reconcileLedger(balanceId);
        sendJson(res, 200, { ok: true, balanceId, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'inventory_reconcile_failed';
        sendJson(res, message === 'balance_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/inventory/safety-buffer') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        variantId?: string;
        variant_id?: string;
        balanceId?: string;
        balance_id?: string;
        safetyBuffer?: number;
        safety_buffer?: number;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        let variantId = (body.variantId ?? body.variant_id)?.trim();
        const balanceId = (body.balanceId ?? body.balance_id)?.trim();
        if ((!storeId || !variantId) && balanceId) {
          const bal = await services.inventory.getBalance(balanceId);
          storeId = bal.store_id;
          variantId = bal.variant_id;
        }
        if (!storeId || !variantId) {
          sendJson(res, 400, { error: 'store_and_variant_required' });
          return;
        }
        const safetyBufferRaw = body.safetyBuffer ?? body.safety_buffer;
        if (typeof safetyBufferRaw !== 'number' || !Number.isFinite(safetyBufferRaw)) {
          sendJson(res, 400, { error: 'invalid_safety_buffer' });
          return;
        }
        const safetyBuffer = Math.floor(safetyBufferRaw);
        const updated = await services.inventory.setSafetyBuffer(storeId, variantId, safetyBuffer);
        const stock = await services.inventory.listStockByVariant(variantId);
        sendJson(res, 200, { ok: true, ...updated, stock });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'safety_buffer_failed';
        sendJson(
          res,
          message === 'balance_not_found' ? 404 : 400,
          { error: message },
        );
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/inventory/adjustments') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const adjustments = await services.inventory.listAdjustmentRequests(limit);
      sendJson(res, 200, { ok: true, adjustments });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/inventory/receive') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        balanceId?: string;
        balance_id?: string;
        quantity?: number;
        reason?: string;
        correlationId?: string;
        correlation_id?: string;
      }>(req);
      try {
        let balanceId = (body.balanceId ?? body.balance_id)?.trim();
        let variantId: string | undefined;
        if (!balanceId) {
          const bal = await services.db.query<{ id: string; variant_id: string }>(
            `SELECT id, variant_id FROM private.inventory_balances
             ORDER BY updated_at DESC LIMIT 1`,
          );
          balanceId = bal.rows[0]?.id;
          variantId = bal.rows[0]?.variant_id;
        }
        if (!balanceId) {
          sendJson(res, 409, { error: 'no_balance' });
          return;
        }
        if (!variantId) {
          const bal = await services.inventory.getBalance(balanceId);
          variantId = bal.variant_id;
        }
        const quantity =
          typeof body.quantity === 'number' && body.quantity > 0
            ? Math.floor(body.quantity)
            : 5;
        const actorIdentityId = await resolveOpsActor(services);
        const balance = await services.inventory.receive({
          balanceId,
          quantity,
          actorIdentityId,
          correlationId: body.correlationId ?? body.correlation_id ?? crypto.randomUUID(),
          reason: body.reason?.trim() || 'local_mock_receive',
        });
        const stock = await services.inventory.listStockByVariant(variantId);
        const adjustments = await services.inventory.listAdjustmentRequests(50);
        sendJson(res, 201, {
          ok: true,
          balanceId,
          variantId,
          onHand: Number(balance.on_hand),
          reserved: Number(balance.reserved),
          safetyBuffer: Number(balance.safety_buffer),
          available: Number(balance.available),
          stock,
          adjustments,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'inventory_receive_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/inventory/adjust') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        balanceId?: string;
        balance_id?: string;
        delta?: number;
        reason?: string;
        correlationId?: string;
        correlation_id?: string;
      }>(req);
      try {
        let balanceId = (body.balanceId ?? body.balance_id)?.trim();
        let variantId: string | undefined;
        if (!balanceId) {
          const bal = await services.db.query<{ id: string; variant_id: string }>(
            `SELECT id, variant_id FROM private.inventory_balances
             ORDER BY updated_at DESC LIMIT 1`,
          );
          balanceId = bal.rows[0]?.id;
          variantId = bal.rows[0]?.variant_id;
        }
        if (!balanceId) {
          sendJson(res, 409, { error: 'no_balance' });
          return;
        }
        if (!variantId) {
          const bal = await services.inventory.getBalance(balanceId);
          variantId = bal.variant_id;
        }
        const delta =
          typeof body.delta === 'number' && body.delta !== 0
            ? Math.trunc(body.delta)
            : -1;
        const reason = body.reason?.trim() || 'local mock cycle count';
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const approverIdentityId = await resolveOpsApprover(services, maker.identityId);
        const result = await services.inventory.adjust({
          balanceId,
          delta,
          reason,
          makerIdentityId: maker.identityId,
          approverIdentityId,
          actorRoles: ['operations'],
          correlationId: body.correlationId ?? body.correlation_id ?? crypto.randomUUID(),
        });
        const stock = await services.inventory.listStockByVariant(variantId);
        const adjustments = await services.inventory.listAdjustmentRequests(50);
        if (!result.ok) {
          sendJson(res, 409, {
            ok: false,
            error: result.reason,
            balanceId,
            stock,
            adjustments,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          balanceId,
          delta,
          status: 'approved',
          onHand: Number(result.balance.on_hand),
          reserved: Number(result.balance.reserved),
          safetyBuffer: Number(result.balance.safety_buffer),
          available: Number(result.balance.available),
          stock,
          adjustments,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'inventory_adjust_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/inventory/import/batches') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const batches = await services.inventory.listStockImportBatches(limit);
      sendJson(res, 200, { ok: true, batches });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/inventory/import/preview') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        idempotencyKey?: string;
        idempotency_key?: string;
        rows?: Array<{
          variantId?: string;
          variant_id?: string;
          lotId?: string;
          lot_id?: string;
          onHand?: number;
          on_hand?: number;
        }>;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const store = await services.db.query<{ id: string }>(
            `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          storeId = store.rows[0]?.id;
        }
        if (!storeId) {
          sendJson(res, 409, { error: 'no_active_store' });
          return;
        }

        let rows = (body.rows ?? []).map((r) => ({
          variantId: (r.variantId ?? r.variant_id ?? '').trim(),
          lotId: (r.lotId ?? r.lot_id ?? '').trim(),
          onHand:
            typeof r.onHand === 'number'
              ? Math.floor(r.onHand)
              : typeof r.on_hand === 'number'
                ? Math.floor(r.on_hand)
                : 0,
        })).filter((r) => r.variantId && r.lotId);

        if (rows.length === 0) {
          const bal = await services.db.query<{
            variant_id: string;
            lot_id: string;
            on_hand: number;
            store_id: string;
          }>(
            `SELECT variant_id, lot_id, on_hand, store_id FROM private.inventory_balances
             WHERE store_id = $1
             ORDER BY updated_at DESC LIMIT 1`,
            [storeId],
          );
          const seed = bal.rows[0];
          if (!seed) {
            sendJson(res, 409, { error: 'no_balance' });
            return;
          }
          rows = [
            {
              variantId: seed.variant_id,
              lotId: seed.lot_id,
              onHand: Number(seed.on_hand) + 5,
            },
          ];
        }

        const preview = await services.inventory.previewStockImport({
          storeId,
          idempotencyKey:
            body.idempotencyKey?.trim() ||
            body.idempotency_key?.trim() ||
            `stock-imp-${crypto.randomUUID()}`,
          rows,
        });
        const batches = await services.inventory.listStockImportBatches(50);
        sendJson(res, 201, {
          ok: true,
          batchId: preview.batchId,
          storeId,
          report: preview.report,
          replay: preview.replay,
          batches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stock_import_preview_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const stockImportCommitMatch = url.pathname.match(
      /^\/v1\/ops\/inventory\/import\/([^/]+)\/commit$/,
    );
    if (req.method === 'POST' && stockImportCommitMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(stockImportCommitMatch[1]!);
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const committed = await services.inventory.commitStockImport({
          batchId,
          actorIdentityId,
        });
        const batches = await services.inventory.listStockImportBatches(50);
        if (!committed.ok) {
          sendJson(res, 409, {
            ok: false,
            error: committed.reason,
            batchId,
            batches,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          batchId,
          replay: committed.replay,
          status: 'committed',
          batches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stock_import_commit_failed';
        sendJson(res, message === 'batch_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/carts') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = await services.orders.createCart(session.identityId);
      sendJson(res, 201, { ok: true, cartId });
      return;
    }

    const cartItemsMatch = url.pathname.match(/^\/v1\/carts\/([^/]+)\/items$/);
    if (req.method === 'POST' && cartItemsMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = decodeURIComponent(cartItemsMatch[1]!);
      const owned = await cartOwnedBy(services, cartId, session.identityId);
      if (!owned) {
        sendJson(res, 403, { error: 'cart_forbidden' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        variantId?: string;
        quantity?: number;
      }>(req);
      if (!body.storeId || !body.variantId || !body.quantity || body.quantity < 1) {
        sendJson(res, 400, { error: 'invalid_cart_item' });
        return;
      }
      await services.orders.addCartItem(cartId, {
        storeId: body.storeId,
        variantId: body.variantId,
        quantity: body.quantity,
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    const cartCheckoutMatch = url.pathname.match(/^\/v1\/carts\/([^/]+)\/checkout$/);
    if (req.method === 'POST' && cartCheckoutMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const cartId = decodeURIComponent(cartCheckoutMatch[1]!);
      const owned = await cartOwnedBy(services, cartId, session.identityId);
      if (!owned) {
        sendJson(res, 403, { error: 'cart_forbidden' });
        return;
      }
      const body = await readJsonBody<{
        shippingLakByStore?: Record<string, number>;
        promoCode?: string;
        promo_code?: string;
      }>(req);
      try {
        const rawCode = (body.promoCode ?? body.promo_code)?.trim();
        let promo: Awaited<ReturnType<typeof services.promotions.findActiveByCode>> | null =
          null;
        let promoPercentOff: number | undefined;
        if (rawCode) {
          promo = await services.promotions.findActiveByCode(rawCode);
          promoPercentOff = promo.percentOff;
        }
        const result = await services.orders.checkout({
          cartId,
          customerIdentityId: session.identityId,
          actorIdentityId: session.identityId,
          shippingLakByStore: body.shippingLakByStore,
          promoPercentOff,
          correlationId: crypto.randomUUID(),
        });
        let promoApplied: {
          code: string;
          percentOff: number;
          discountLak: number;
        } | null = null;
        if (promo) {
          const parent = await services.db.query<{ discount_lak: number }>(
            `SELECT discount_lak FROM app.parent_orders WHERE id = $1`,
            [result.parentId],
          );
          const discountLak = Number(parent.rows[0]?.discount_lak ?? 0);
          await services.promotions.recordCheckoutRedemption({
            promotionId: promo.promotionId,
            parentOrderId: result.parentId,
            amountLak: discountLak,
            idempotencyKey: `checkout:${result.parentId}:${promo.promotionId}`,
          });
          promoApplied = {
            code: promo.code,
            percentOff: promo.percentOff,
            discountLak,
          };
        }
        sendJson(res, 201, { ok: true, ...result, promo: promoApplied });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'checkout_failed';
        const status =
          message === 'cart_empty' ||
          message === 'variant_not_active' ||
          message === 'store_not_accepting_orders' ||
          message === 'price_not_approved' ||
          message === 'promotion_inactive' ||
          message === 'promotion_cap_exceeded' ||
          message === 'promo_percent_required'
            ? 409
            : message === 'promotion_not_found'
              ? 404
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/orders') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const orders = await services.orders.listRecentOrders(limit);
      sendJson(res, 200, { ok: true, orders });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/support/tickets') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const escalatedParam = url.searchParams.get('escalated');
      const escalatedOnly = escalatedParam === '1' || escalatedParam === 'true';
      const tickets = await services.support.listTickets(limit, escalatedOnly);
      sendJson(res, 200, { ok: true, tickets });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/me/support/tickets') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const tickets = await services.support.listTicketsForCustomer(
        session.identityId,
        limit,
      );
      sendJson(res, 200, { ok: true, tickets });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/support/tickets') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        subject?: string;
        body?: string;
        channel?: 'in_app' | 'whatsapp' | 'phone';
        urgency?: 'general' | 'urgent';
        externalRef?: string;
        external_ref?: string;
      }>(req);
      const subject = body.subject?.trim();
      const message = body.body?.trim();
      if (!subject || !message) {
        sendJson(res, 400, { error: 'subject_and_body_required' });
        return;
      }
      const channel = body.channel ?? 'in_app';
      if (!['in_app', 'whatsapp', 'phone'].includes(channel)) {
        sendJson(res, 400, { error: 'invalid_channel' });
        return;
      }
      const urgency = body.urgency ?? 'general';
      if (!['general', 'urgent'].includes(urgency)) {
        sendJson(res, 400, { error: 'invalid_urgency' });
        return;
      }
      try {
        const created = await services.support.openTicket({
          customerIdentityId: session.identityId,
          channel,
          subject,
          body: message,
          urgency,
          externalRef: body.externalRef ?? body.external_ref,
        });
        const tickets = await services.support.listTicketsForCustomer(
          session.identityId,
          50,
        );
        sendJson(res, 201, { ok: true, ...created, tickets });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : 'support_open_failed';
        sendJson(res, 400, { error: messageText });
      }
      return;
    }

    const supportConfirmCloseMatch = url.pathname.match(
      /^\/v1\/me\/support\/tickets\/([^/]+)\/confirm-close$/,
    );
    if (req.method === 'POST' && supportConfirmCloseMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const ticketId = decodeURIComponent(supportConfirmCloseMatch[1]!);
      try {
        await services.support.assertTicketOwner(ticketId, session.identityId);
        await services.support.customerConfirmClose(ticketId);
        const tickets = await services.support.listTicketsForCustomer(
          session.identityId,
          50,
        );
        sendJson(res, 200, { ok: true, ticketId, status: 'closed', tickets });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'support_close_failed';
        const status =
          message === 'not_ticket_owner'
            ? 403
            : message === 'ticket_not_found'
              ? 404
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const supportReopenMatch = url.pathname.match(
      /^\/v1\/me\/support\/tickets\/([^/]+)\/reopen$/,
    );
    if (req.method === 'POST' && supportReopenMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const ticketId = decodeURIComponent(supportReopenMatch[1]!);
      const body = await readJsonBody<{ body?: string }>(req);
      try {
        await services.support.reopen(
          ticketId,
          session.identityId,
          body.body?.trim() || 'Still need help',
        );
        const tickets = await services.support.listTicketsForCustomer(
          session.identityId,
          50,
        );
        sendJson(res, 200, { ok: true, ticketId, status: 'reopened', tickets });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'support_reopen_failed';
        const status =
          message === 'not_ticket_owner'
            ? 403
            : message === 'ticket_not_found'
              ? 404
              : message === 'ticket_not_closed'
                ? 409
                : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/returns') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const returns = await services.returns.listReturns(limit);
      sendJson(res, 200, { ok: true, returns });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/delivery-claims') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const claims = await services.delivery.listClaims(limit);
      sendJson(res, 200, { ok: true, claims });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/delivery-claims/mock-open') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        deliveryId?: string;
        delivery_id?: string;
        claimType?: 'lost' | 'damaged';
        claim_type?: 'lost' | 'damaged';
        notes?: string;
      }>(req);
      try {
        let deliveryId = (body.deliveryId ?? body.delivery_id)?.trim();
        if (!deliveryId) {
          const eligible = await services.db.query<{ id: string }>(
            `SELECT d.id
             FROM app.shipment_deliveries d
             WHERE d.status = 'delivered'
               AND NOT EXISTS (
                 SELECT 1 FROM app.delivery_claims c
                 WHERE c.shipment_delivery_id = d.id
                   AND c.status IN ('open', 'platform_coordinating')
               )
             ORDER BY d.delivered_at DESC NULLS LAST
             LIMIT 1`,
          );
          deliveryId = eligible.rows[0]?.id;
        }
        if (!deliveryId) {
          sendJson(res, 409, { error: 'no_eligible_delivery' });
          return;
        }
        const claimTypeRaw = body.claimType ?? body.claim_type ?? 'damaged';
        if (claimTypeRaw !== 'lost' && claimTypeRaw !== 'damaged') {
          sendJson(res, 400, { error: 'invalid_claim_type' });
          return;
        }
        const opened = await services.delivery.openClaim({
          deliveryId,
          claimType: claimTypeRaw,
          notes: body.notes?.trim() || 'local mock delivery claim',
        });
        const claims = await services.delivery.listClaims(50);
        sendJson(res, 201, {
          ok: true,
          ...opened,
          deliveryId,
          claimType: claimTypeRaw,
          status: 'platform_coordinating',
          claims,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'claim_open_failed';
        const status =
          message === 'delivery_not_found'
            ? 404
            : message === 'delivery_not_delivered' || message === 'claim_already_open'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const claimResolveMatch = url.pathname.match(
      /^\/v1\/ops\/delivery-claims\/([^/]+)\/resolve$/,
    );
    if (req.method === 'POST' && claimResolveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const claimId = decodeURIComponent(claimResolveMatch[1]!);
      const body = await readJsonBody<{
        status?: 'resolved' | 'rejected';
        notes?: string;
      }>(req);
      const statusRaw = body.status ?? 'resolved';
      if (statusRaw !== 'resolved' && statusRaw !== 'rejected') {
        sendJson(res, 400, { error: 'invalid_claim_status' });
        return;
      }
      try {
        const resolved = await services.delivery.resolveClaim({
          claimId,
          status: statusRaw,
          notes: body.notes,
        });
        const claims = await services.delivery.listClaims(50);
        sendJson(res, 200, { ok: true, ...resolved, claims });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'claim_resolve_failed';
        const status =
          message === 'claim_not_found'
            ? 404
            : message === 'claim_not_open'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/packing-deadlines') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const lateParam = url.searchParams.get('late');
      const lateOnly = lateParam === '1' || lateParam === 'true';
      const deadlines = await services.delivery.listPackingDeadlines(limit, lateOnly);
      sendJson(res, 200, { ok: true, deadlines });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/packing-deadlines/mock-evaluate') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        childOrderId?: string;
        child_order_id?: string;
        now?: string;
        hoursAgo?: number;
        hours_ago?: number;
      }>(req);
      try {
        let childOrderId = (body.childOrderId ?? body.child_order_id)?.trim();
        if (!childOrderId) {
          const existing = await services.db.query<{ child_order_id: string }>(
            `SELECT child_order_id FROM app.packing_deadlines
             ORDER BY due_at DESC LIMIT 1`,
          );
          childOrderId = existing.rows[0]?.child_order_id;
        }
        if (!childOrderId) {
          const child = await services.db.query<{ id: string }>(
            `SELECT id FROM app.child_orders ORDER BY created_at DESC LIMIT 1`,
          );
          childOrderId = child.rows[0]?.id;
        }
        if (!childOrderId) {
          sendJson(res, 409, { error: 'no_eligible_child' });
          return;
        }
        const now = body.now ? new Date(body.now) : new Date();
        if (Number.isNaN(now.getTime())) {
          sendJson(res, 400, { error: 'invalid_now' });
          return;
        }
        const hoursAgoRaw = body.hoursAgo ?? body.hours_ago ?? 25;
        const hoursAgo =
          typeof hoursAgoRaw === 'number' && Number.isFinite(hoursAgoRaw)
            ? Math.max(hoursAgoRaw, 1)
            : 25;
        const confirmedAt = new Date(now.getTime() - hoursAgo * 60 * 60_000);
        await services.delivery.schedulePackingDeadline(childOrderId, confirmedAt);
        // Clear packed_at so evaluate reflects an overdue unpacked SLA when prior
        // mock-advance packed on time relative to the old clock.
        await services.db.query(
          `UPDATE app.packing_deadlines
           SET packed_at = NULL, late = false, alerted_at = NULL
           WHERE child_order_id = $1`,
          [childOrderId],
        );
        const evaluated = await services.delivery.evaluateLatePacking(childOrderId, now);
        const deadlines = await services.delivery.listPackingDeadlines(50);
        sendJson(res, 200, {
          ok: true,
          childOrderId,
          late: evaluated.late,
          confirmedAt: confirmedAt.toISOString(),
          now: now.toISOString(),
          deadlines,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'packing_evaluate_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/me/returns') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const returns = await services.returns.listReturnsForCustomer(
        session.identityId,
        limit,
      );
      sendJson(res, 200, { ok: true, returns });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/returns') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        childOrderId?: string;
        child_order_id?: string;
        reason?: string;
        evidenceKeys?: string[];
        evidence_keys?: string[];
      }>(req);
      const childOrderId = body.childOrderId ?? body.child_order_id;
      if (!childOrderId?.trim()) {
        sendJson(res, 400, { error: 'child_order_id_required' });
        return;
      }
      const reasonRaw = body.reason ?? 'defective';
      const allowed = [
        'defective',
        'wrong_item',
        'incomplete',
        'materially_not_described',
      ] as const;
      if (!(allowed as readonly string[]).includes(reasonRaw)) {
        sendJson(res, 400, { error: 'invalid_return_reason' });
        return;
      }
      try {
        const owned = await services.returns.resolveOwnedDeliveredChild({
          childOrderId: childOrderId.trim(),
          customerIdentityId: session.identityId,
        });
        const evidenceKeys =
          body.evidenceKeys ??
          body.evidence_keys ??
          [`customer/return/${childOrderId.trim()}.jpg`];
        const created = await services.returns.requestReturn({
          childOrderId: childOrderId.trim(),
          reason: reasonRaw as (typeof allowed)[number],
          deliveredAt: owned.deliveredAt,
          evidenceKeys,
          createdBy: session.identityId,
        });
        const returns = await services.returns.listReturnsForCustomer(
          session.identityId,
          50,
        );
        sendJson(res, 201, { ok: true, ...created, returns });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'return_create_failed';
        const status =
          message === 'not_order_owner'
            ? 403
            : message === 'child_order_not_found'
              ? 404
              : message === 'child_not_delivered' ||
                  message === 'return_window_exceeded' ||
                  message === 'change_of_mind_not_allowed' ||
                  message === 'invalid_return_reason'
                ? 409
                : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/promotions') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const promotions = await services.promotions.listPromotions(limit);
      sendJson(res, 200, { ok: true, promotions });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/recalls') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const recalls = await services.recalls.listRecalls(limit);
      sendJson(res, 200, { ok: true, recalls });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/recalls/mock-start') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        productId?: string;
        product_id?: string;
        reason?: string;
        lotId?: string;
        lot_id?: string;
      }>(req);
      let productId = body.productId ?? body.product_id;
      if (!productId) {
        const product = await services.db.query<{ id: string }>(
          `SELECT id FROM app.products WHERE status = 'active' ORDER BY created_at LIMIT 1`,
        );
        productId = product.rows[0]?.id;
      }
      if (!productId) {
        sendJson(res, 409, { error: 'no_active_product' });
        return;
      }
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const created = await services.recalls.startRecall({
          productId,
          lotId: body.lotId ?? body.lot_id,
          reason: body.reason?.trim() || 'local_mock_recall',
          createdBy: actorIdentityId,
        });
        const recalls = await services.recalls.listRecalls(50);
        const affected = await services.recalls.listAffected(created.recallId, 50);
        sendJson(res, 201, { ok: true, ...created, recalls, affected });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'recall_start_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const recallContactMatch = url.pathname.match(
      /^\/v1\/ops\/recalls\/([^/]+)\/contact$/,
    );
    if (req.method === 'POST' && recallContactMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const recallId = decodeURIComponent(recallContactMatch[1]!);
      const body = await readJsonBody<{
        childOrderId?: string;
        child_order_id?: string;
        contactStatus?: 'contacted' | 'unreachable';
        contact_status?: 'contacted' | 'unreachable';
        resolution?: 'refund' | 'replacement' | 'declined' | 'pending';
      }>(req);
      let childOrderId = body.childOrderId ?? body.child_order_id;
      if (!childOrderId) {
        const first = await services.recalls.listAffected(recallId, 1);
        childOrderId = first[0]?.childOrderId;
      }
      if (!childOrderId) {
        sendJson(res, 409, { error: 'no_affected_orders' });
        return;
      }
      const contactStatus = body.contactStatus ?? body.contact_status ?? 'contacted';
      if (!['contacted', 'unreachable'].includes(contactStatus)) {
        sendJson(res, 400, { error: 'invalid_contact_status' });
        return;
      }
      try {
        await services.recalls.recordContact({
          recallId,
          childOrderId,
          contactStatus,
          resolution: body.resolution ?? 'refund',
        });
        const completion = await services.recalls.isComplete(recallId);
        const recalls = await services.recalls.listRecalls(50);
        const affected = await services.recalls.listAffected(recallId, 50);
        sendJson(res, 200, {
          ok: true,
          recallId,
          childOrderId,
          ...completion,
          recalls,
          affected,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'recall_contact_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/stores/quality') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const storeId = url.searchParams.get('storeId')?.trim() || undefined;
      const [events, suspensions] = await Promise.all([
        services.quality.listEvents(limit, storeId),
        services.quality.listSuspensions(limit),
      ]);
      sendJson(res, 200, { ok: true, events, suspensions });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/stores/quality/mock-event') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        eventType?: string;
        event_type?: string;
        count?: number;
      }>(req);
      let storeId = body.storeId ?? body.store_id;
      if (!storeId) {
        const store = await services.db.query<{ id: string }>(
          `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
        );
        storeId = store.rows[0]?.id;
      }
      if (!storeId) {
        sendJson(res, 409, { error: 'no_active_store' });
        return;
      }
      const eventTypeRaw = body.eventType ?? body.event_type ?? 'slow_response_or_pack';
      const allowed = [
        'slow_response_or_pack',
        'stock_mismatch',
        'wrong_damaged_mismatch',
        'fraud_or_security',
      ] as const;
      if (!(allowed as readonly string[]).includes(eventTypeRaw)) {
        sendJson(res, 400, { error: 'invalid_event_type' });
        return;
      }
      const count =
        typeof body.count === 'number' && body.count > 0 && body.count <= 20
          ? Math.floor(body.count)
          : 1;
      try {
        let last: Awaited<ReturnType<typeof services.quality.recordEvent>> | null = null;
        for (let i = 0; i < count; i += 1) {
          last = await services.quality.recordEvent({
            storeId,
            eventType: eventTypeRaw as (typeof allowed)[number],
          });
        }
        const [events, suspensions] = await Promise.all([
          services.quality.listEvents(50, storeId),
          services.quality.listSuspensions(50),
        ]);
        sendJson(res, 201, {
          ok: true,
          storeId,
          eventType: eventTypeRaw,
          count,
          result: last,
          events,
          suspensions,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'quality_event_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeReactivateMatch = url.pathname.match(
      /^\/v1\/ops\/stores\/([^/]+)\/reactivate$/,
    );
    if (req.method === 'POST' && storeReactivateMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const storeId = decodeURIComponent(storeReactivateMatch[1]!);
      const body = await readJsonBody<{
        evidence?: string;
        correctiveActionEvidence?: string;
      }>(req);
      const evidence =
        body.correctiveActionEvidence?.trim() ||
        body.evidence?.trim() ||
        'local mock corrective action evidence';
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const result = await services.quality.reactivate({
          storeId,
          actorIdentityId,
          actorRoles: ['owner'],
          correctiveActionEvidence: evidence,
        });
        if (!result.ok) {
          sendJson(res, 400, { error: result.reason });
          return;
        }
        const [events, suspensions] = await Promise.all([
          services.quality.listEvents(50, storeId),
          services.quality.listSuspensions(50),
        ]);
        sendJson(res, 200, { ok: true, storeId, status: 'active', events, suspensions });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'store_reactivate_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeDocUploadMatch = url.pathname.match(
      /^\/v1\/ops\/stores\/([^/]+)\/documents\/mock-upload$/,
    );
    if (req.method === 'POST' && storeDocUploadMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const storeId = decodeURIComponent(storeDocUploadMatch[1]!);
      const body = await readJsonBody<{
        docType?: 'owner_id' | 'store_info' | 'bank_account' | 'contract';
        doc_type?: 'owner_id' | 'store_info' | 'bank_account' | 'contract';
        storageKey?: string;
        storage_key?: string;
        expiresAt?: string;
        expires_at?: string;
        scheduleExpiryAlert?: boolean;
        schedule_expiry_alert?: boolean;
      }>(req);
      const docType = body.docType ?? body.doc_type ?? 'owner_id';
      const allowed = ['owner_id', 'store_info', 'bank_account', 'contract'] as const;
      if (!(allowed as readonly string[]).includes(docType)) {
        sendJson(res, 400, { error: 'invalid_doc_type' });
        return;
      }
      try {
        const store = await services.db.query<{ id: string }>(
          `SELECT id FROM app.stores WHERE id = $1`,
          [storeId],
        );
        if (!store.rows[0]) {
          sendJson(res, 404, { error: 'store_not_found' });
          return;
        }
        const storageKey =
          body.storageKey?.trim() ||
          body.storage_key?.trim() ||
          `private/${storeId}/${docType}-${crypto.randomUUID().slice(0, 8)}.pdf`;
        const expiresAt = body.expiresAt ?? body.expires_at ?? '2027-12-31';
        const documentId = await services.stores.uploadDocument({
          storeId,
          docType,
          storageKey,
          expiresAt,
        });
        if (body.scheduleExpiryAlert ?? body.schedule_expiry_alert ?? true) {
          await services.stores.scheduleDocumentExpiryAlerts(documentId, expiresAt);
        }
        const documents = await services.stores.listDocuments({ storeId, limit: 50 });
        const onboarding = await services.stores.getOnboarding(storeId);
        sendJson(res, 201, {
          ok: true,
          documentId,
          storeId,
          docType,
          storageKey,
          status: 'uploaded',
          documents,
          onboarding,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'document_upload_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeDocVerifyMatch = url.pathname.match(
      /^\/v1\/ops\/stores\/documents\/([^/]+)\/verify$/,
    );
    if (req.method === 'POST' && storeDocVerifyMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const documentId = decodeURIComponent(storeDocVerifyMatch[1]!);
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const doc = await services.db.query<{ store_id: string }>(
            `SELECT store_id FROM private.store_documents WHERE id = $1`,
            [documentId],
          );
          storeId = doc.rows[0]?.store_id;
        }
        if (!storeId) {
          sendJson(res, 404, { error: 'document_not_found' });
          return;
        }
        await services.stores.verifyDocument(documentId, storeId);
        const documents = await services.stores.listDocuments({ storeId, limit: 50 });
        const onboarding = await services.stores.getOnboarding(storeId);
        sendJson(res, 200, {
          ok: true,
          documentId,
          storeId,
          status: 'verified',
          documents,
          onboarding,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'document_verify_failed';
        sendJson(res, message === 'document_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    const storeDocSignedMatch = url.pathname.match(
      /^\/v1\/ops\/stores\/documents\/([^/]+)\/signed-access$/,
    );
    if (req.method === 'POST' && storeDocSignedMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const documentId = decodeURIComponent(storeDocSignedMatch[1]!);
      const body = await readJsonBody<{
        reason?: string;
      }>(req);
      const reason = body.reason?.trim() || 'local mock document review';
      try {
        const doc = await services.db.query<{
          store_id: string;
          storage_key: string;
        }>(
          `SELECT store_id, storage_key FROM private.store_documents WHERE id = $1`,
          [documentId],
        );
        if (!doc.rows[0]) {
          sendJson(res, 404, { error: 'document_not_found' });
          return;
        }
        const actorIdentityId = await resolveOpsActor(services);
        const access = await services.stores.issueSignedAccess({
          storageKey: doc.rows[0].storage_key,
          actorIdentityId,
          documentId,
          reason,
        });
        sendJson(res, 200, {
          ok: true,
          documentId,
          storeId: doc.rows[0].store_id,
          token: access.token,
          expiresAt: access.expiresAt,
          reason,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'signed_access_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeFulfillmentMatch = url.pathname.match(
      /^\/v1\/ops\/stores\/([^/]+)\/fulfillment\/mock-ensure$/,
    );
    if (req.method === 'POST' && storeFulfillmentMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const storeId = decodeURIComponent(storeFulfillmentMatch[1]!);
      const body = await readJsonBody<{
        name?: string;
        addressLine?: string;
        address_line?: string;
      }>(req);
      try {
        const store = await services.db.query<{ id: string }>(
          `SELECT id FROM app.stores WHERE id = $1`,
          [storeId],
        );
        if (!store.rows[0]) {
          sendJson(res, 404, { error: 'store_not_found' });
          return;
        }
        const existing = await services.stores.countActiveFulfillment(storeId);
        let locationId: string | null = null;
        if (existing === 0) {
          locationId = await services.stores.addFulfillmentLocation({
            storeId,
            name: body.name?.trim() || 'Main',
            addressLine: body.addressLine?.trim() || body.address_line?.trim() || 'Vientiane',
            active: true,
          });
        } else {
          const loc = await services.db.query<{ id: string }>(
            `SELECT id FROM app.fulfillment_locations
             WHERE store_id = $1 AND active = true AND archived_at IS NULL
             LIMIT 1`,
            [storeId],
          );
          locationId = loc.rows[0]?.id ?? null;
        }
        const onboarding = await services.stores.getOnboarding(storeId);
        sendJson(res, 200, {
          ok: true,
          storeId,
          locationId,
          ensured: existing === 0,
          onboarding,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fulfillment_ensure_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const storeActivateMatch = url.pathname.match(/^\/v1\/ops\/stores\/([^/]+)\/activate$/);
    if (req.method === 'POST' && storeActivateMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const storeId = decodeURIComponent(storeActivateMatch[1]!);
      try {
        const result = await services.stores.activateIfReady(storeId);
        const onboarding = await services.stores.getOnboarding(storeId);
        const stores = await services.stores.listStores();
        if (!result.ok) {
          sendJson(res, 409, {
            ok: false,
            error: result.reason,
            storeId,
            onboarding,
            stores,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          storeId,
          status: 'active',
          onboarding,
          stores,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'store_activate_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/refunds') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const refunds = await services.returns.listRefundApprovals(limit);
      sendJson(res, 200, { ok: true, refunds });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/pricing/requests') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const requests = await services.pricing.listPriceRequests(limit);
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/pricing/mock-propose') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        variantId?: string;
        variant_id?: string;
        costLak?: number;
        cost_lak?: number;
        sellingPriceLak?: number;
        selling_price_lak?: number;
        compareAtPriceLak?: number;
        compare_at_price_lak?: number;
        reason?: string;
        belowCost?: boolean;
        below_cost?: boolean;
      }>(req);
      try {
        let variantId = (body.variantId ?? body.variant_id)?.trim();
        if (!variantId) {
          const variant = await services.db.query<{ id: string }>(
            `SELECT id FROM app.product_variants
             WHERE status = 'active'
             ORDER BY created_at
             LIMIT 1`,
          );
          variantId = variant.rows[0]?.id;
        }
        if (!variantId) {
          sendJson(res, 409, { error: 'no_active_variant' });
          return;
        }
        const active = await services.pricing.activePrice(variantId);
        const wantBelow = body.belowCost ?? body.below_cost ?? false;
        const costLak =
          typeof body.costLak === 'number'
            ? Math.floor(body.costLak)
            : typeof body.cost_lak === 'number'
              ? Math.floor(body.cost_lak)
              : active
                ? Number(active.cost_lak)
                : 5000;
        let sellingPriceLak =
          typeof body.sellingPriceLak === 'number'
            ? Math.floor(body.sellingPriceLak)
            : typeof body.selling_price_lak === 'number'
              ? Math.floor(body.selling_price_lak)
              : active
                ? Number(active.selling_price_lak) + 500
                : 7000;
        if (wantBelow) {
          sellingPriceLak = Math.max(1, costLak - 100);
        }
        if (costLak <= 0 || sellingPriceLak <= 0) {
          sendJson(res, 400, { error: 'invalid_price' });
          return;
        }
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const proposed = await services.pricing.proposePrice({
          variantId,
          costLak,
          sellingPriceLak,
          compareAtPriceLak:
            typeof body.compareAtPriceLak === 'number'
              ? Math.floor(body.compareAtPriceLak)
              : typeof body.compare_at_price_lak === 'number'
                ? Math.floor(body.compare_at_price_lak)
                : undefined,
          reason:
            body.reason?.trim() ||
            (wantBelow || sellingPriceLak < costLak
              ? 'local_mock_below_cost_clearance'
              : undefined),
          makerIdentityId: maker.identityId,
        });
        const requests = await services.pricing.listPriceRequests(50);
        sendJson(res, 201, { ok: true, ...proposed, variantId, requests });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'price_propose_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const priceApproveMatch = url.pathname.match(/^\/v1\/ops\/pricing\/([^/]+)\/approve$/);
    if (req.method === 'POST' && priceApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const requestId = decodeURIComponent(priceApproveMatch[1]!);
      const body = await readJsonBody<{
        stepUpVerified?: boolean;
        step_up_verified?: boolean;
      }>(req);
      try {
        const reqRow = await services.db.query<{
          maker_identity_id: string;
          requires_owner: boolean;
          requires_2fa: boolean;
          status: string;
        }>(
          `SELECT maker_identity_id, requires_owner, requires_2fa, status
           FROM finance.price_change_requests WHERE id = $1`,
          [requestId],
        );
        if (!reqRow.rows[0]) {
          sendJson(res, 404, { error: 'price_request_not_found' });
          return;
        }
        if (reqRow.rows[0].status !== 'pending') {
          sendJson(res, 409, { error: 'not_pending' });
          return;
        }
        const makerIdentityId = reqRow.rows[0].maker_identity_id;
        let approverIdentityId: string;
        let actorRoles: string[];
        if (reqRow.rows[0].requires_owner) {
          const owner = await services.identity.ensureStaff(
            'staff:local-catalog-owner',
            'Catalog Owner',
            '+8562087000002',
          );
          if (owner.identityId === makerIdentityId) {
            sendJson(res, 409, { error: 'self_approval' });
            return;
          }
          approverIdentityId = owner.identityId;
          actorRoles = ['owner'];
        } else {
          approverIdentityId = await resolveOpsApprover(services, makerIdentityId);
          // Prefer owner when available for local approvals.
          const owner = await services.db.query<{ id: string }>(
            `SELECT id FROM security.auth_identities
             WHERE subject = 'staff:local-catalog-owner' AND id <> $1
             LIMIT 1`,
            [makerIdentityId],
          );
          if (owner.rows[0]) {
            approverIdentityId = owner.rows[0].id;
            actorRoles = ['owner'];
          } else {
            actorRoles = ['catalog', 'admin'];
          }
        }
        const stepUpVerified =
          body.stepUpVerified ??
          body.step_up_verified ??
          (reqRow.rows[0].requires_2fa ? true : false);
        const approved = await services.pricing.approvePrice({
          requestId,
          approverIdentityId,
          actorRoles,
          stepUpVerified,
        });
        if (!approved.ok) {
          const status =
            approved.reason === 'not_found'
              ? 404
              : approved.reason === 'not_pending' || approved.reason === 'self_approval'
                ? 409
                : approved.reason === 'owner_required' ||
                    approved.reason === '2fa_required' ||
                    approved.reason === 'not_authorized'
                  ? 403
                  : 400;
          sendJson(res, status, { error: approved.reason });
          return;
        }
        const requests = await services.pricing.listPriceRequests(50);
        sendJson(res, 200, {
          ok: true,
          requestId,
          status: 'approved',
          priceVersionId: approved.priceVersionId,
          requests,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'price_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/pricing/near-expiry') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const requests = await services.pricing.listNearExpiryDiscounts(limit);
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/pricing/near-expiry/mock-propose') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        variantId?: string;
        variant_id?: string;
        proposedSellingPriceLak?: number;
        proposed_selling_price_lak?: number;
        reason?: string;
        lotId?: string;
        lot_id?: string;
        linkLot?: boolean;
        link_lot?: boolean;
      }>(req);
      try {
        let variantId = (body.variantId ?? body.variant_id)?.trim();
        if (!variantId) {
          const variant = await services.db.query<{ id: string }>(
            `SELECT id FROM app.product_variants
             WHERE status = 'active'
             ORDER BY created_at
             LIMIT 1`,
          );
          variantId = variant.rows[0]?.id;
        }
        if (!variantId) {
          sendJson(res, 409, { error: 'no_active_variant' });
          return;
        }
        const active = await services.pricing.activePrice(variantId);
        const proposedSellingPriceLak =
          typeof body.proposedSellingPriceLak === 'number'
            ? Math.floor(body.proposedSellingPriceLak)
            : typeof body.proposed_selling_price_lak === 'number'
              ? Math.floor(body.proposed_selling_price_lak)
              : active
                ? Math.max(1, Number(active.selling_price_lak) - 1000)
                : 3500;
        if (proposedSellingPriceLak < 0) {
          sendJson(res, 400, { error: 'invalid_price' });
          return;
        }
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const requestId = await services.pricing.requestNearExpiryDiscount({
          variantId,
          proposedSellingPriceLak,
          reason: body.reason?.trim() || 'local_mock_near_expiry_clearance',
          makerIdentityId: maker.identityId,
        });
        let linkedLotId: string | null = null;
        const shouldLink = body.linkLot ?? body.link_lot ?? true;
        if (shouldLink) {
          let lotId = (body.lotId ?? body.lot_id)?.trim();
          if (!lotId) {
            const lot = await services.db.query<{ id: string }>(
              `SELECT id FROM private.inventory_lots
               WHERE variant_id = $1 AND status = 'available'
               ORDER BY created_at
               LIMIT 1`,
              [variantId],
            );
            lotId = lot.rows[0]?.id;
          }
          if (lotId) {
            await services.inventory.linkExpiryDiscount(lotId, requestId);
            linkedLotId = lotId;
          }
        }
        const requests = await services.pricing.listNearExpiryDiscounts(50);
        sendJson(res, 201, {
          ok: true,
          requestId,
          variantId,
          proposedSellingPriceLak,
          linkedLotId,
          status: 'pending',
          requests,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'near_expiry_propose_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const nearExpiryApproveMatch = url.pathname.match(
      /^\/v1\/ops\/pricing\/near-expiry\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && nearExpiryApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const requestId = decodeURIComponent(nearExpiryApproveMatch[1]!);
      try {
        const reqRow = await services.db.query<{
          maker_identity_id: string;
          status: string;
        }>(
          `SELECT maker_identity_id, status
           FROM finance.near_expiry_discount_requests WHERE id = $1`,
          [requestId],
        );
        if (!reqRow.rows[0]) {
          sendJson(res, 404, { error: 'near_expiry_request_not_found' });
          return;
        }
        if (reqRow.rows[0].status !== 'pending') {
          sendJson(res, 409, { error: 'not_pending' });
          return;
        }
        const approverIdentityId = await resolveOpsApprover(
          services,
          reqRow.rows[0].maker_identity_id,
        );
        const approved = await services.pricing.approveNearExpiryDiscount({
          requestId,
          approverIdentityId,
        });
        if (!approved.ok) {
          const status =
            approved.reason === 'not_found'
              ? 404
              : approved.reason === 'not_pending' || approved.reason === 'self_approval'
                ? 409
                : 400;
          sendJson(res, status, { error: approved.reason });
          return;
        }
        const requests = await services.pricing.listNearExpiryDiscounts(50);
        sendJson(res, 200, {
          ok: true,
          requestId,
          status: 'approved',
          variantId: approved.variantId,
          proposedSellingPriceLak: approved.proposedSellingPriceLak,
          requests,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'near_expiry_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/audit/events') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const events = await services.audit.listRecent(limit);
      sendJson(res, 200, { ok: true, events });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/exports') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const exports = await services.exports.listExports(limit);
      sendJson(res, 200, { ok: true, exports });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/notifications') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const [inbox, outbox] = await Promise.all([
        services.notifications.listInboxRecent(limit),
        services.notifications.listOutbox(limit),
      ]);
      sendJson(res, 200, { ok: true, inbox, outbox });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/integrations') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const stores = await services.ego.listStoreStatuses(limit);
      const traffic = services.ego.assertNoProductionTraffic();
      sendJson(res, 200, {
        ok: true,
        env: env.APP_ENV,
        integrationsMode: env.INTEGRATIONS_MODE,
        egoPosEnabled: env.EGO_POS_ENABLED,
        inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
        productionHold: !env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        smsProvider:
          env.INTEGRATIONS_MODE === 'mock'
            ? 'mock'
            : env.INTEGRATIONS_MODE === 'sandbox'
              ? 'sandbox'
              : 'external',
        canSendEgoTraffic: traffic.canSendTraffic,
        checklist: [
          {
            id: 'ego_disabled',
            label: 'EGO POS flag OFF',
            ok: !env.EGO_POS_ENABLED,
          },
          {
            id: 'no_ego_traffic',
            label: 'No EGO production traffic',
            ok: !traffic.canSendTraffic,
          },
          {
            id: 'integrations_not_live',
            label: 'Integrations mode not live',
            ok: env.INTEGRATIONS_MODE !== 'live',
          },
          {
            id: 'sms_not_mock_in_prod',
            label: 'SMS mock only outside production',
            ok: env.APP_ENV !== 'production' || env.INTEGRATIONS_MODE !== 'mock',
          },
          {
            id: 'no_demo_auth_bypass',
            label: 'No demo auth bypass',
            ok: true,
          },
        ],
        stores,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/staff') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const [roles, staff] = await Promise.all([
        Promise.resolve(listRoleCatalog()),
        services.identity.listStaffDirectory(limit),
      ]);
      sendJson(res, 200, { ok: true, roles, staff });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/identity/mock-lock') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        identityId?: string;
        identity_id?: string;
        subject?: string;
      }>(req);
      try {
        const staff = await services.identity.listStaffDirectory(100);
        const identityId = (body.identityId ?? body.identity_id)?.trim();
        const subject = body.subject?.trim();
        const target =
          (identityId ? staff.find((s) => s.identityId === identityId) : undefined) ??
          (subject ? staff.find((s) => s.subject === subject) : undefined) ??
          staff.find((s) => s.subject === 'staff:local-catalog-maker' && s.status !== 'locked') ??
          staff.find((s) => !s.roles.includes('owner') && s.status !== 'locked');
        if (!target) {
          sendJson(res, 404, { error: 'staff_not_found' });
          return;
        }
        if (target.roles.includes('owner')) {
          sendJson(res, 400, { error: 'owner_lock_forbidden' });
          return;
        }
        if (target.status === 'locked') {
          const [roles, directory] = await Promise.all([
            Promise.resolve(listRoleCatalog()),
            services.identity.listStaffDirectory(50),
          ]);
          sendJson(res, 200, {
            ok: true,
            identityId: target.identityId,
            subject: target.subject,
            status: 'locked',
            alreadyLocked: true,
            roles,
            staff: directory,
          });
          return;
        }
        let count = 0;
        while (count < services.identity.maxFailedLogins) {
          count = await services.identity.recordFailedLogin(target.identityId);
        }
        const [roles, directory] = await Promise.all([
          Promise.resolve(listRoleCatalog()),
          services.identity.listStaffDirectory(50),
        ]);
        const locked = directory.find((s) => s.identityId === target.identityId);
        sendJson(res, 200, {
          ok: true,
          identityId: target.identityId,
          subject: target.subject,
          status: locked?.status ?? 'locked',
          failedLoginCount: count,
          roles,
          staff: directory,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'identity_lock_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const staffUnlockMatch = url.pathname.match(/^\/v1\/ops\/staff\/([^/]+)\/unlock$/);
    if (req.method === 'POST' && staffUnlockMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const identityId = decodeURIComponent(staffUnlockMatch[1]!);
      const body = await readJsonBody<{ reason?: string }>(req);
      try {
        const staff = await services.identity.listStaffDirectory(100);
        const target = staff.find((s) => s.identityId === identityId);
        if (!target) {
          sendJson(res, 404, { error: 'staff_not_found' });
          return;
        }
        const actorIdentityId = await resolveOpsActor(services);
        const actorRow = staff.find((s) => s.identityId === actorIdentityId);
        const actorRoles =
          actorRow?.roles.length ? actorRow.roles : (['owner'] as string[]);
        const decision = await services.identity.unlockIdentity({
          targetIdentityId: identityId,
          actorIdentityId,
          actorRoles,
          targetRoles: target.roles,
          reason: body.reason?.trim() || 'local_mock_unlock',
        });
        if (!decision.ok) {
          const status =
            decision.reason === 'self_unlock_forbidden'
              ? 403
              : decision.reason === 'owner_required_for_admin'
                ? 403
                : 400;
          sendJson(res, status, { error: decision.reason });
          return;
        }
        const [roles, directory] = await Promise.all([
          Promise.resolve(listRoleCatalog()),
          services.identity.listStaffDirectory(50),
        ]);
        sendJson(res, 200, {
          ok: true,
          identityId,
          subject: target.subject,
          status: 'active',
          roles,
          staff: directory,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'staff_unlock_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/reports/dashboard') {
      const storeId = url.searchParams.get('store_id')?.trim() || undefined;
      try {
        const kpis = await services.reports.dashboardKpis({
          actorRoles: ['owner', 'operations'],
          storeId,
        });
        sendJson(res, 200, { ok: true, kpis });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'dashboard_kpis_failed';
        sendJson(res, message.startsWith('forbidden_') ? 403 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/reports/payments/reconcile') {
      try {
        const reconcile = await services.reports.reconcilePayments({
          actorRoles: ['finance', 'owner'],
        });
        sendJson(res, 200, { ok: true, reconcile });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'payments_reconcile_failed';
        sendJson(res, message.startsWith('forbidden_') ? 403 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/payments/mismatches') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const mismatches = await services.payments.listMismatches(limit);
      sendJson(res, 200, { ok: true, mismatches });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/payments/adjustments') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const adjustments = await services.payments.listAdjustments(limit);
      sendJson(res, 200, { ok: true, adjustments });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/payments/mismatches/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        mismatchType?: 'bank' | 'cod' | 'allocation';
        mismatch_type?: 'bank' | 'cod' | 'allocation';
        referenceId?: string;
        reference_id?: string;
        expectedLak?: number;
        expected_lak?: number;
        actualLak?: number;
        actual_lak?: number;
      }>(req);
      try {
        let referenceId = (body.referenceId ?? body.reference_id)?.trim();
        if (!referenceId) {
          const payment = await services.db.query<{ id: string }>(
            `SELECT id FROM finance.payment_requests ORDER BY created_at DESC LIMIT 1`,
          );
          referenceId = payment.rows[0]?.id;
        }
        if (!referenceId) {
          // Seed a synthetic reference for local QA when no payments exist yet.
          referenceId = crypto.randomUUID();
        }
        const expectedLak =
          typeof body.expectedLak === 'number'
            ? Math.floor(body.expectedLak)
            : typeof body.expected_lak === 'number'
              ? Math.floor(body.expected_lak)
              : 10000;
        const actualLak =
          typeof body.actualLak === 'number'
            ? Math.floor(body.actualLak)
            : typeof body.actual_lak === 'number'
              ? Math.floor(body.actual_lak)
              : expectedLak + 1000;
        const mismatchType = body.mismatchType ?? body.mismatch_type ?? 'bank';
        const inserted = await services.db.query<{ id: string }>(
          `INSERT INTO finance.recon_mismatches
            (mismatch_type, reference_id, expected_lak, actual_lak)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [mismatchType, referenceId, expectedLak, actualLak],
        );
        const mismatches = await services.payments.listMismatches(50);
        sendJson(res, 201, {
          ok: true,
          mismatchId: inserted.rows[0]!.id,
          referenceId,
          expectedLak,
          actualLak,
          status: 'open',
          mismatches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'mismatch_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const mismatchResolveMatch = url.pathname.match(
      /^\/v1\/ops\/payments\/mismatches\/([^/]+)\/resolve$/,
    );
    if (req.method === 'POST' && mismatchResolveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const mismatchId = decodeURIComponent(mismatchResolveMatch[1]!);
      const body = await readJsonBody<{
        note?: string;
        createAdjustment?: boolean;
        create_adjustment?: boolean;
        amountLak?: number;
        amount_lak?: number;
        paymentRequestId?: string;
        payment_request_id?: string;
      }>(req);
      const note = body.note?.trim() || 'local_mock_mismatch_resolved';
      try {
        const mismatch = await services.db.query<{
          id: string;
          status: string;
          reference_id: string;
          expected_lak: number;
          actual_lak: number;
        }>(
          `SELECT id, status, reference_id, expected_lak, actual_lak
           FROM finance.recon_mismatches WHERE id = $1`,
          [mismatchId],
        );
        if (!mismatch.rows[0]) {
          sendJson(res, 404, { error: 'mismatch_not_found' });
          return;
        }
        if (mismatch.rows[0].status !== 'open') {
          sendJson(res, 409, { error: 'not_open' });
          return;
        }
        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const wantAdj = body.createAdjustment ?? body.create_adjustment ?? true;
        const amountLak =
          typeof body.amountLak === 'number'
            ? Math.floor(body.amountLak)
            : typeof body.amount_lak === 'number'
              ? Math.floor(body.amount_lak)
              : Math.max(
                  1,
                  Math.abs(
                    Number(mismatch.rows[0].actual_lak) - Number(mismatch.rows[0].expected_lak),
                  ) || 1,
                );
        let paymentRequestId =
          (body.paymentRequestId ?? body.payment_request_id)?.trim() ||
          mismatch.rows[0].reference_id;
        const paymentExists = await services.db.query<{ id: string }>(
          `SELECT id FROM finance.payment_requests WHERE id = $1`,
          [paymentRequestId],
        );
        if (!paymentExists.rows[0]) {
          const fallback = await services.db.query<{ id: string }>(
            `SELECT id FROM finance.payment_requests ORDER BY created_at DESC LIMIT 1`,
          );
          paymentRequestId = fallback.rows[0]?.id ?? '';
        }
        const resolved = await services.payments.resolveMismatch({
          mismatchId,
          actorIdentityId: maker.identityId,
          note,
          createAdjustment: wantAdj
            ? { amountLak, paymentRequestId: paymentRequestId || null }
            : undefined,
        });

        const mismatches = await services.payments.listMismatches(50);
        const adjustments = await services.payments.listAdjustments(50);
        sendJson(res, 200, {
          ok: true,
          mismatchId,
          status: 'resolved',
          adjustmentId: resolved.adjustmentId,
          mismatches,
          adjustments,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'mismatch_resolve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const adjustmentApproveMatch = url.pathname.match(
      /^\/v1\/ops\/payments\/adjustments\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && adjustmentApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const adjustmentId = decodeURIComponent(adjustmentApproveMatch[1]!);
      try {
        const adj = await services.db.query<{
          maker_identity_id: string;
          status: string;
        }>(
          `SELECT maker_identity_id, status FROM finance.payment_adjustments WHERE id = $1`,
          [adjustmentId],
        );
        if (!adj.rows[0]) {
          sendJson(res, 404, { error: 'adjustment_not_found' });
          return;
        }
        if (adj.rows[0].status !== 'pending') {
          sendJson(res, 409, { error: 'not_pending' });
          return;
        }
        const approverIdentityId = await resolveOpsApprover(
          services,
          adj.rows[0].maker_identity_id,
        );
        const approved = await services.payments.approveAdjustment({
          adjustmentId,
          approverIdentityId,
        });
        if (!approved.ok) {
          const status =
            approved.reason === 'not_found'
              ? 404
              : approved.reason === 'self_approval' || approved.reason === 'not_pending'
                ? 409
                : 400;
          sendJson(res, status, { error: approved.reason });
          return;
        }
        const adjustments = await services.payments.listAdjustments(50);
        sendJson(res, 200, {
          ok: true,
          adjustmentId,
          status: 'approved',
          adjustments,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'adjustment_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/backups') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const [jobs, alerts] = await Promise.all([
        services.backups.listJobs(limit),
        services.backups.listAlerts(limit),
      ]);
      sendJson(res, 200, { ok: true, jobs, alerts });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/backups/mock-run') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        job_type?: BackupType;
        jobType?: BackupType;
        fail?: boolean;
      }>(req);
      const jobType = (body.job_type ?? body.jobType ?? 'daily_critical') as BackupType;
      if (!['daily_critical', 'weekly_full', 'pre_migration'].includes(jobType)) {
        sendJson(res, 400, { error: 'invalid_job_type' });
        return;
      }
      try {
        const result = await services.backups.runBackup({
          jobType,
          fail: body.fail === true,
        });
        const [jobs, alerts] = await Promise.all([
          services.backups.listJobs(50),
          services.backups.listAlerts(50),
        ]);
        sendJson(res, 201, { ok: true, ...result, jobs, alerts });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'backup_run_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const backupVerifyMatch = url.pathname.match(/^\/v1\/ops\/backups\/([^/]+)\/verify$/);
    if (req.method === 'POST' && backupVerifyMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const jobId = decodeURIComponent(backupVerifyMatch[1]!);
      try {
        const verified = await services.backups.verifyChecksum(jobId);
        const jobs = await services.backups.listJobs(50);
        if (!verified.ok) {
          sendJson(res, 409, { error: verified.reason ?? 'verify_failed', jobs });
          return;
        }
        sendJson(res, 200, { ok: true, jobId, checksum: verified.checksum, jobs });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'backup_verify_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const backupDrillMatch = url.pathname.match(/^\/v1\/ops\/backups\/([^/]+)\/restore-drill$/);
    if (req.method === 'POST' && backupDrillMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const jobId = decodeURIComponent(backupDrillMatch[1]!);
      try {
        const drill = await services.backups.restoreDrill(jobId);
        const jobs = await services.backups.listJobs(50);
        sendJson(res, 200, { ok: true, jobId, evidence: drill.evidence, jobs });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'backup_drill_failed';
        sendJson(res, message === 'backup_not_ready' ? 409 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/exports/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        export_type?: string;
        reason?: string;
        payload?: string;
      }>(req);
      const reason = body.reason?.trim() || 'local mock compliance extract';
      try {
        const requesterIdentityId = await resolveOpsActor(services);
        const exportId = await services.exports.requestExport({
          requesterIdentityId,
          exportType: body.export_type?.trim() || 'orders_summary',
          reason,
          payload: Buffer.from(body.payload ?? '{"rows":[],"source":"local_mock"}', 'utf8'),
        });
        const exports = await services.exports.listExports(50);
        sendJson(res, 201, { ok: true, exportId, exports });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'export_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const exportApproveMatch = url.pathname.match(/^\/v1\/ops\/exports\/([^/]+)\/approve$/);
    if (req.method === 'POST' && exportApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const exportId = decodeURIComponent(exportApproveMatch[1]!);
      try {
        const row = await services.db.query<{ requester_identity_id: string }>(
          `SELECT requester_identity_id FROM security.export_requests WHERE id = $1`,
          [exportId],
        );
        if (!row.rows[0]) {
          sendJson(res, 404, { error: 'export_not_found' });
          return;
        }
        const actorIdentityId = await resolveOpsApprover(
          services,
          row.rows[0].requester_identity_id,
        );
        const approved = await services.exports.approve({ exportId, actorIdentityId });
        const exports = await services.exports.listExports(50);
        sendJson(res, 200, {
          ok: true,
          exportId,
          status: approved.status,
          expiresAt: approved.expiresAt,
          exports,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'export_approve_failed';
        const status =
          message === 'export not found'
            ? 404
            : message.includes('self approval') || message.includes('not pending')
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const exportDownloadMatch = url.pathname.match(/^\/v1\/ops\/exports\/([^/]+)\/mock-download$/);
    if (req.method === 'POST' && exportDownloadMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const exportId = decodeURIComponent(exportDownloadMatch[1]!);
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const result = await services.exports.download({ exportId, actorIdentityId });
        const exports = await services.exports.listExports(50);
        if (!result.ok) {
          sendJson(res, 409, { error: result.reason, exports });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          exportId,
          status: result.next.status,
          downloadCount: result.next.downloadCount,
          exports,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'export_download_failed';
        sendJson(res, message === 'export not found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/notifications/mock-enqueue') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        title?: string;
        body?: string;
        template?: string;
        channel?: 'in_app' | 'sms' | 'push' | 'email';
      }>(req);
      try {
        const recipientIdentityId = await resolveOpsActor(services);
        const title = body.title?.trim() || 'Local mock notification';
        const message = body.body?.trim() || 'Queued from backoffice Notifications section';
        const template = body.template?.trim() || 'ops.mock_ping';
        const channel = body.channel ?? 'in_app';
        const outboxId = await services.notifications.enqueue({
          channel,
          provider: 'memory',
          destination: recipientIdentityId,
          template,
          title,
          body: message,
          recipientIdentityId,
          actionLink: '/notifications',
          payload: { source: 'local_mock' },
        });
        const [inbox, outbox] = await Promise.all([
          services.notifications.listInboxRecent(50),
          services.notifications.listOutbox(50),
        ]);
        sendJson(res, 201, { ok: true, outboxId, inbox, outbox });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'notification_enqueue_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/notifications/mock-process') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      try {
        await services.notifications.processOutbox();
        const [inbox, outbox] = await Promise.all([
          services.notifications.listInboxRecent(50),
          services.notifications.listOutbox(50),
        ]);
        sendJson(res, 200, { ok: true, inbox, outbox });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'notification_process_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const inboxMarkReadMatch = url.pathname.match(
      /^\/v1\/ops\/notifications\/inbox\/([^/]+)\/mark-read$/,
    );
    if (req.method === 'POST' && inboxMarkReadMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const inboxId = decodeURIComponent(inboxMarkReadMatch[1]!);
      try {
        await services.notifications.markReadById(inboxId);
        const [inbox, outbox] = await Promise.all([
          services.notifications.listInboxRecent(50),
          services.notifications.listOutbox(50),
        ]);
        sendJson(res, 200, { ok: true, inboxId, inbox, outbox });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'notification_mark_read_failed';
        sendJson(res, message === 'inbox_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/integrations/ego/mock-ensure') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      try {
        const profiles = await services.ego.ensureProfilesForActiveStores();
        const stores = await services.ego.listStoreStatuses(50);
        sendJson(res, 200, { ok: true, profiles, stores });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'ego_ensure_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/audit/mock-event') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        action?: string;
        target_type?: string;
        target_id?: string;
        reason?: string;
      }>(req);
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const eventId = await services.audit.append({
          actorIdentityId,
          actorType: 'staff',
          action: body.action?.trim() || 'ops.mock_event',
          targetType: body.target_type?.trim() || 'local_qa',
          targetId: body.target_id?.trim() || crypto.randomUUID(),
          reason: body.reason?.trim() || 'local_mock_audit',
          correlationId: crypto.randomUUID(),
        });
        const events = await services.audit.listRecent(50);
        sendJson(res, 201, { ok: true, eventId, events });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'audit_append_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/refunds/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        child_order_id?: string;
        childOrderId?: string;
        amount_lak?: number;
        reason?: string;
      }>(req);
      let childOrderId = body.child_order_id ?? body.childOrderId;
      if (!childOrderId) {
        const eligible = await services.db.query<{ id: string; total_lak: number }>(
          `SELECT co.id, co.total_lak
           FROM app.child_orders co
           WHERE co.payment_received = true
             AND co.status IN ('delivered', 'return_requested')
             AND NOT EXISTS (
               SELECT 1 FROM app.refund_requests rr
               WHERE rr.child_order_id = co.id AND rr.status IN ('pending', 'approved', 'paid')
             )
           ORDER BY co.updated_at DESC
           LIMIT 1`,
        );
        childOrderId = eligible.rows[0]?.id;
      }
      if (!childOrderId) {
        sendJson(res, 409, { error: 'no_eligible_child_for_refund' });
        return;
      }
      const child = await services.db.query<{
        id: string;
        total_lak: number;
        payment_received: boolean;
      }>(
        `SELECT id, total_lak, payment_received FROM app.child_orders WHERE id = $1`,
        [childOrderId],
      );
      if (!child.rows[0]) {
        sendJson(res, 404, { error: 'child_order_not_found' });
        return;
      }
      if (!child.rows[0].payment_received) {
        sendJson(res, 409, { error: 'payment_not_received' });
        return;
      }
      const amountLak =
        typeof body.amount_lak === 'number' && body.amount_lak > 0
          ? Math.floor(body.amount_lak)
          : Number(child.rows[0].total_lak);
      if (amountLak <= 0) {
        sendJson(res, 400, { error: 'invalid_amount' });
        return;
      }
      try {
        const makerIdentityId = await resolveOpsActor(services);
        const created = await services.returns.createRefundRequest({
          childOrderId,
          amountLak,
          reason: body.reason?.trim() || 'local_mock_refund',
          makerIdentityId,
        });
        const refunds = await services.returns.listRefundApprovals(50);
        sendJson(res, 201, { ok: true, ...created, refunds });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'refund_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const refundApproveMatch = url.pathname.match(/^\/v1\/ops\/refunds\/([^/]+)\/approve$/);
    if (req.method === 'POST' && refundApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const approvalId = decodeURIComponent(refundApproveMatch[1]!);
      try {
        const maker = await services.db.query<{ maker_identity_id: string }>(
          `SELECT maker_identity_id FROM app.refund_approvals WHERE id = $1`,
          [approvalId],
        );
        if (!maker.rows[0]) {
          sendJson(res, 404, { error: 'refund_approval_not_found' });
          return;
        }
        const approverIdentityId = await resolveOpsApprover(
          services,
          maker.rows[0].maker_identity_id,
        );
        const approved = await services.returns.approveRefund({
          approvalId,
          approverIdentityId,
        });
        const refunds = await services.returns.listRefundApprovals(50);
        sendJson(res, 200, { ok: true, approvalId, status: 'approved', ...approved, refunds });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'refund_approve_failed';
        const status =
          message === 'refund_approval_not_found'
            ? 404
            : message === 'self_approval_denied' || message === 'refund_not_pending'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const refundPayMatch = url.pathname.match(/^\/v1\/ops\/refunds\/([^/]+)\/mock-pay$/);
    if (req.method === 'POST' && refundPayMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const approvalId = decodeURIComponent(refundPayMatch[1]!);
      const linked = await services.db.query<{
        payment_request_id: string | null;
        status: string;
      }>(
        `SELECT a.status,
                (
                  SELECT pa.payment_request_id
                  FROM finance.payment_allocations pa
                  JOIN app.refund_requests rr ON rr.id = a.refund_request_id
                  WHERE pa.child_order_id = rr.child_order_id
                  LIMIT 1
                ) AS payment_request_id
         FROM app.refund_approvals a
         WHERE a.id = $1`,
        [approvalId],
      );
      if (!linked.rows[0]) {
        sendJson(res, 404, { error: 'refund_approval_not_found' });
        return;
      }
      if (!linked.rows[0].payment_request_id) {
        sendJson(res, 409, { error: 'payment_request_missing' });
        return;
      }
      try {
        const paid = await services.returns.payRefundViaLedger({
          approvalId,
          paymentRequestId: linked.rows[0].payment_request_id,
        });
        const refunds = await services.returns.listRefundApprovals(50);
        sendJson(res, 200, { ok: true, approvalId, status: 'paid', ...paid, refunds });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'refund_pay_failed';
        const status = message === 'refund_not_approved' ? 409 : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/promotions/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        code?: string;
        title_en?: string;
        title_lo?: string;
        percent_off?: number;
        amount_off_lak?: number;
        funding?: 'platform' | 'supplier' | 'split';
        budget_lak?: number;
      }>(req);
      const code =
        body.code?.trim().toUpperCase() ||
        `LOCAL${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const percentOff =
        typeof body.percent_off === 'number' && Number.isFinite(body.percent_off)
          ? body.percent_off
          : undefined;
      const amountOffLak =
        typeof body.amount_off_lak === 'number' && Number.isFinite(body.amount_off_lak)
          ? body.amount_off_lak
          : undefined;
      try {
        const from = new Date();
        const to = new Date(from.getTime() + 30 * 24 * 60 * 60_000);
        const promotionId = await services.promotions.createPromotion({
          code,
          titleEn: body.title_en?.trim() || 'Local mock promo',
          titleLo: body.title_lo?.trim() || 'ໂປຣໂມຊັນ mock',
          percentOff: amountOffLak == null ? (percentOff ?? 10) : undefined,
          amountOffLak: amountOffLak != null && percentOff == null ? amountOffLak : undefined,
          funding: body.funding ?? 'platform',
          budgetLak: body.budget_lak ?? 500_000,
          effectiveFrom: from,
          effectiveTo: to,
          allowStack: false,
        });
        const promotions = await services.promotions.listPromotions(50);
        sendJson(res, 201, { ok: true, promotionId, promotions });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'promotion_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const promoPauseMatch = url.pathname.match(/^\/v1\/ops\/promotions\/([^/]+)\/pause$/);
    if (req.method === 'POST' && promoPauseMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const promotionId = decodeURIComponent(promoPauseMatch[1]!);
      try {
        await services.promotions.pausePromotion(promotionId);
        const promotions = await services.promotions.listPromotions(50);
        sendJson(res, 200, { ok: true, promotionId, status: 'paused', promotions });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'promotion_pause_failed';
        const status =
          message === 'promotion_not_found'
            ? 404
            : message === 'promotion_not_active'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/returns/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        child_order_id?: string;
        childOrderId?: string;
        reason?: string;
      }>(req);
      let childOrderId = body.child_order_id ?? body.childOrderId;
      if (!childOrderId) {
        const eligible = await services.db.query<{
          id: string;
          delivered_at: string | null;
        }>(
          `SELECT co.id, sd.delivered_at::text
           FROM app.child_orders co
           JOIN app.shipment_deliveries sd ON sd.child_order_id = co.id
           WHERE co.status = 'delivered'
             AND sd.status = 'delivered'
             AND NOT EXISTS (
               SELECT 1 FROM app.return_requests rr WHERE rr.child_order_id = co.id
             )
           ORDER BY sd.delivered_at DESC
           LIMIT 1`,
        );
        childOrderId = eligible.rows[0]?.id;
      }
      if (!childOrderId) {
        sendJson(res, 409, { error: 'no_eligible_delivered_child' });
        return;
      }
      const delivery = await services.db.query<{
        delivered_at: string | null;
        status: string;
        customer_identity_id: string;
      }>(
        `SELECT sd.delivered_at::text, co.status, po.customer_identity_id
         FROM app.child_orders co
         JOIN app.parent_orders po ON po.id = co.parent_order_id
         LEFT JOIN app.shipment_deliveries sd ON sd.child_order_id = co.id AND sd.status = 'delivered'
         WHERE co.id = $1
         ORDER BY sd.delivered_at DESC NULLS LAST
         LIMIT 1`,
        [childOrderId],
      );
      const child = delivery.rows[0];
      if (!child) {
        sendJson(res, 404, { error: 'child_order_not_found' });
        return;
      }
      if (child.status !== 'delivered' || !child.delivered_at) {
        sendJson(res, 409, { error: 'child_not_delivered' });
        return;
      }
      const reasonRaw = body.reason ?? 'defective';
      const allowed = [
        'defective',
        'wrong_item',
        'incomplete',
        'materially_not_described',
      ] as const;
      if (!(allowed as readonly string[]).includes(reasonRaw)) {
        sendJson(res, 400, { error: 'invalid_return_reason' });
        return;
      }
      try {
        const created = await services.returns.requestReturn({
          childOrderId,
          reason: reasonRaw as (typeof allowed)[number],
          deliveredAt: new Date(child.delivered_at),
          evidenceKeys: [`mock/return/${childOrderId}.jpg`],
          createdBy: child.customer_identity_id,
        });
        const returns = await services.returns.listReturns(50);
        sendJson(res, 201, { ok: true, ...created, returns });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'return_create_failed';
        const status =
          message === 'return_window_exceeded' ||
          message === 'change_of_mind_not_allowed' ||
          message === 'invalid_return_reason'
            ? 409
            : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const returnApproveMatch = url.pathname.match(/^\/v1\/ops\/returns\/([^/]+)\/approve$/);
    if (req.method === 'POST' && returnApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const returnRequestId = decodeURIComponent(returnApproveMatch[1]!);
      try {
        await services.returns.approveReturn(returnRequestId);
        const returns = await services.returns.listReturns(50);
        sendJson(res, 200, { ok: true, returnRequestId, status: 'approved', returns });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'return_approve_failed';
        const status =
          message === 'return_not_found' ? 404 : message === 'return_not_pending' ? 409 : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/support/tickets/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        subject?: string;
        body?: string;
        urgency?: 'general' | 'urgent';
        channel?: 'in_app' | 'whatsapp' | 'phone';
      }>(req);
      const subject = body.subject?.trim() || 'Local mock support ticket';
      const message = body.body?.trim() || 'Need help with a local QA order.';
      try {
        const customerIdentityId = await services.identity.ensureCustomer(
          '+8562097008800',
          'Local Support Customer',
        );
        const created = await services.support.openTicket({
          customerIdentityId,
          channel: body.channel ?? 'in_app',
          subject,
          body: message,
          urgency: body.urgency ?? 'general',
        });
        const tickets = await services.support.listTickets(50);
        sendJson(res, 201, { ok: true, ...created, tickets });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'support_create_failed';
        sendJson(res, 400, { error: msg });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/support/tickets/mock-evaluate-sla') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        ticketId?: string;
        ticket_id?: string;
        now?: string;
      }>(req);
      try {
        let ticketId = (body.ticketId ?? body.ticket_id)?.trim();
        const now = body.now ? new Date(body.now) : new Date();
        if (Number.isNaN(now.getTime())) {
          sendJson(res, 400, { error: 'invalid_now' });
          return;
        }
        if (!ticketId) {
          const existing = await services.db.query<{ id: string }>(
            `SELECT id FROM app.support_tickets
             WHERE escalated_at IS NULL
               AND status NOT IN ('closed')
             ORDER BY created_at DESC
             LIMIT 1`,
          );
          ticketId = existing.rows[0]?.id;
        }
        if (!ticketId) {
          const customerIdentityId = await services.identity.ensureCustomer(
            '+8562097008800',
            'Local Support Customer',
          );
          const createdAt = new Date(now.getTime() - 48 * 60 * 60_000);
          const created = await services.support.openTicket({
            customerIdentityId,
            channel: 'in_app',
            subject: 'Local SLA evaluate ticket',
            body: 'Opened for mock SLA evaluate.',
            urgency: 'general',
            now: createdAt,
          });
          ticketId = created.ticketId;
        }
        const evaluated = await services.support.evaluateSla(ticketId, now);
        const tickets = await services.support.listTickets(50);
        sendJson(res, 200, {
          ok: true,
          ticketId,
          ...evaluated,
          now: now.toISOString(),
          tickets,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'support_sla_evaluate_failed';
        sendJson(res, message === 'ticket_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/support/tickets/mock-auto-close') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        ticketId?: string;
        ticket_id?: string;
        now?: string;
      }>(req);
      try {
        let ticketId = (body.ticketId ?? body.ticket_id)?.trim();
        const now = body.now ? new Date(body.now) : new Date();
        if (Number.isNaN(now.getTime())) {
          sendJson(res, 400, { error: 'invalid_now' });
          return;
        }
        if (!ticketId) {
          const pending = await services.db.query<{ id: string }>(
            `SELECT id FROM app.support_tickets
             WHERE status = 'resolved_pending_confirm'
             ORDER BY created_at DESC
             LIMIT 1`,
          );
          ticketId = pending.rows[0]?.id;
        }
        if (!ticketId) {
          const customerIdentityId = await services.identity.ensureCustomer(
            '+8562097008800',
            'Local Support Customer',
          );
          const created = await services.support.openTicket({
            customerIdentityId,
            channel: 'in_app',
            subject: 'Local auto-close ticket',
            body: 'Opened for mock auto-close.',
            urgency: 'general',
            now: new Date(now.getTime() - 5 * 24 * 60 * 60_000),
          });
          ticketId = created.ticketId;
          await services.support.markPreliminaryResolved(
            ticketId,
            new Date(now.getTime() - 4 * 24 * 60 * 60_000),
          );
        }
        const result = await services.support.autoCloseIfStale(ticketId, now);
        const tickets = await services.support.listTickets(50);
        sendJson(res, 200, {
          ok: true,
          ticketId,
          closed: result.closed,
          status: result.closed ? 'closed' : undefined,
          now: now.toISOString(),
          tickets,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'support_auto_close_failed';
        sendJson(res, message === 'ticket_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    const supportReplyMatch = url.pathname.match(
      /^\/v1\/ops\/support\/tickets\/([^/]+)\/reply$/,
    );
    if (req.method === 'POST' && supportReplyMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const ticketId = decodeURIComponent(supportReplyMatch[1]!);
      const body = await readJsonBody<{ body?: string }>(req);
      const message = body.body?.trim();
      if (!message) {
        sendJson(res, 400, { error: 'body_required' });
        return;
      }
      const existing = await services.db.query<{ id: string }>(
        `SELECT id FROM app.support_tickets WHERE id = $1`,
        [ticketId],
      );
      if (!existing.rows[0]) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }
      try {
        const staffIdentityId = await resolveOpsActor(services);
        await services.support.staffReply({
          ticketId,
          staffIdentityId,
          body: message,
        });
        const tickets = await services.support.listTickets(50);
        sendJson(res, 200, { ok: true, ticketId, status: 'awaiting_customer', tickets });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'support_reply_failed';
        sendJson(res, 400, { error: msg });
      }
      return;
    }

    const supportResolveMatch = url.pathname.match(
      /^\/v1\/ops\/support\/tickets\/([^/]+)\/resolve$/,
    );
    if (req.method === 'POST' && supportResolveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const ticketId = decodeURIComponent(supportResolveMatch[1]!);
      const existing = await services.db.query<{ id: string }>(
        `SELECT id FROM app.support_tickets WHERE id = $1`,
        [ticketId],
      );
      if (!existing.rows[0]) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return;
      }
      try {
        await services.support.markPreliminaryResolved(ticketId);
        const tickets = await services.support.listTickets(50);
        sendJson(res, 200, {
          ok: true,
          ticketId,
          status: 'resolved_pending_confirm',
          tickets,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'support_resolve_failed';
        sendJson(res, 400, { error: msg });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/settlements') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const batches = await services.settlements.listBatches(limit);
      sendJson(res, 200, { ok: true, batches });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/settlements/carryforwards') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const carryforwards = await services.settlements.listCarryforwards(limit);
      sendJson(res, 200, { ok: true, carryforwards });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/settlements/mock-carryforward') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        storeId?: string;
        store_id?: string;
        amountLak?: number;
        amount_lak?: number;
        sourceBatchId?: string;
        source_batch_id?: string;
        collect?: boolean;
      }>(req);
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const fromBatch = await services.db.query<{ store_id: string }>(
            `SELECT store_id FROM finance.settlement_batches ORDER BY created_at DESC LIMIT 1`,
          );
          storeId = fromBatch.rows[0]?.store_id;
        }
        if (!storeId) {
          const store = await services.db.query<{ id: string }>(
            `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at LIMIT 1`,
          );
          storeId = store.rows[0]?.id;
        }
        if (!storeId) {
          sendJson(res, 404, { error: 'store_not_found' });
          return;
        }
        const amountLak =
          typeof body.amountLak === 'number'
            ? Math.trunc(body.amountLak)
            : typeof body.amount_lak === 'number'
              ? Math.trunc(body.amount_lak)
              : -25000;
        const created = await services.settlements.recordNegativeCarryForward({
          storeId,
          amountLak,
          sourceBatchId: (body.sourceBatchId ?? body.source_batch_id)?.trim() || undefined,
          collect: body.collect ?? true,
        });
        const carryforwards = await services.settlements.listCarryforwards(50);
        sendJson(res, 201, {
          ok: true,
          ...created,
          storeId,
          amountLak,
          status: 'open',
          carryforwards,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'carryforward_failed';
        sendJson(res, message === 'carryforward_must_be_negative' ? 400 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/settlements/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{ store_id?: string; storeId?: string }>(req);
      const requestedStoreId = body.store_id ?? body.storeId;
      let storeId = requestedStoreId;
      if (!storeId) {
        const stores = await services.db.query<{ id: string }>(
          `SELECT id FROM app.stores WHERE status = 'active' ORDER BY created_at`,
        );
        for (const store of stores.rows) {
          const eligible = await services.settlements.listEligibleChildOrders(store.id);
          if (eligible.length > 0) {
            storeId = store.id;
            break;
          }
        }
      }
      if (!storeId) {
        sendJson(res, 409, { error: 'no_eligible_orders' });
        return;
      }
      const storeRow = await services.db.query<{ id: string }>(
        `SELECT id FROM app.stores WHERE id = $1`,
        [storeId],
      );
      if (!storeRow.rows[0]) {
        sendJson(res, 404, { error: 'store_not_found' });
        return;
      }
      const eligible = await services.settlements.listEligibleChildOrders(storeId);
      if (eligible.length === 0) {
        sendJson(res, 409, { error: 'no_eligible_orders' });
        return;
      }
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const periodEnd = new Date();
        const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60_000);
        const created = await services.settlements.createBatch({
          storeId,
          makerIdentityId: actorIdentityId,
          periodStart,
          periodEnd,
        });
        const batches = await services.settlements.listBatches(50);
        sendJson(res, 201, { ok: true, ...created, batches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'settlement_create_failed';
        const status =
          message === 'active_payout_account_required' || message === 'payout_account_on_hold'
            ? 409
            : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const settlementLinesMatch = url.pathname.match(/^\/v1\/settlements\/([^/]+)\/lines$/);
    if (req.method === 'GET' && settlementLinesMatch) {
      const batchId = decodeURIComponent(settlementLinesMatch[1]!);
      const batch = await services.db.query<{ id: string }>(
        `SELECT id FROM finance.settlement_batches WHERE id = $1`,
        [batchId],
      );
      if (!batch.rows[0]) {
        sendJson(res, 404, { error: 'batch_not_found' });
        return;
      }
      const lines = await services.settlements.listLines(batchId);
      sendJson(res, 200, { ok: true, batchId, lines });
      return;
    }

    const settlementSubmitMatch = url.pathname.match(
      /^\/v1\/ops\/settlements\/([^/]+)\/submit$/,
    );
    if (req.method === 'POST' && settlementSubmitMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(settlementSubmitMatch[1]!);
      try {
        await services.settlements.submitForApproval(batchId);
        const batches = await services.settlements.listBatches(50);
        sendJson(res, 200, { ok: true, batchId, status: 'pending_approval', batches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'settlement_submit_failed';
        const status =
          message === 'batch_not_found'
            ? 404
            : message === 'batch_not_submittable'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const settlementApproveMatch = url.pathname.match(
      /^\/v1\/ops\/settlements\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && settlementApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(settlementApproveMatch[1]!);
      try {
        const maker = await services.db.query<{ maker_identity_id: string }>(
          `SELECT maker_identity_id FROM finance.settlement_batches WHERE id = $1`,
          [batchId],
        );
        if (!maker.rows[0]) {
          sendJson(res, 404, { error: 'batch_not_found' });
          return;
        }
        const approverIdentityId = await resolveOpsApprover(
          services,
          maker.rows[0].maker_identity_id,
        );
        await services.settlements.approveBatch({ batchId, approverIdentityId });
        const batches = await services.settlements.listBatches(50);
        sendJson(res, 200, { ok: true, batchId, status: 'approved', batches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'settlement_approve_failed';
        const status =
          message === 'batch_not_found'
            ? 404
            : message === 'self_approval_denied' || message === 'batch_not_approvable'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const settlementDisputeMatch = url.pathname.match(
      /^\/v1\/ops\/settlements\/([^/]+)\/dispute$/,
    );
    if (req.method === 'POST' && settlementDisputeMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(settlementDisputeMatch[1]!);
      const body = await readJsonBody<{
        child_order_id?: string;
        childOrderId?: string;
        reason?: string;
      }>(req);
      let childOrderId = body.child_order_id ?? body.childOrderId;
      if (!childOrderId) {
        const lines = await services.settlements.listLines(batchId);
        childOrderId = lines.find((l) => !l.disputed)?.childOrderId ?? lines[0]?.childOrderId;
      }
      if (!childOrderId) {
        sendJson(res, 409, { error: 'no_settlement_lines' });
        return;
      }
      try {
        const dispute = await services.settlements.openDispute({
          batchId,
          childOrderId,
          reason: body.reason?.trim() || 'local_mock_dispute',
        });
        const batches = await services.settlements.listBatches(50);
        sendJson(res, 200, {
          ok: true,
          batchId,
          childOrderId,
          status: 'partially_disputed',
          ...dispute,
          batches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'settlement_dispute_failed';
        const status =
          message === 'batch_not_found' || message === 'settlement_line_not_found'
            ? 404
            : message === 'dispute_window_exceeded'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const settlementHoldMatch = url.pathname.match(
      /^\/v1\/ops\/settlements\/([^/]+)\/hold-line$/,
    );
    if (req.method === 'POST' && settlementHoldMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const batchId = decodeURIComponent(settlementHoldMatch[1]!);
      const body = await readJsonBody<{
        child_order_id?: string;
        childOrderId?: string;
        reason?: string;
      }>(req);
      try {
        const batch = await services.db.query<{ id: string }>(
          `SELECT id FROM finance.settlement_batches WHERE id = $1`,
          [batchId],
        );
        if (!batch.rows[0]) {
          sendJson(res, 404, { error: 'batch_not_found' });
          return;
        }
        let childOrderId = body.child_order_id ?? body.childOrderId;
        const lines = await services.settlements.listLines(batchId);
        if (!childOrderId) {
          childOrderId = lines.find((l) => !l.held)?.childOrderId ?? lines[0]?.childOrderId;
        }
        if (!childOrderId) {
          sendJson(res, 409, { error: 'no_settlement_lines' });
          return;
        }
        if (!lines.some((l) => l.childOrderId === childOrderId)) {
          sendJson(res, 404, { error: 'settlement_line_not_found' });
          return;
        }
        const holdReason = body.reason?.trim() || 'local_mock_hold';
        await services.settlements.holdLine({
          batchId,
          childOrderId,
          reason: holdReason,
        });
        const [updatedLines, batches] = await Promise.all([
          services.settlements.listLines(batchId),
          services.settlements.listBatches(50),
        ]);
        sendJson(res, 200, {
          ok: true,
          batchId,
          childOrderId,
          held: true,
          holdReason,
          lines: updatedLines,
          batches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'settlement_hold_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const opsConfirmMatch = url.pathname.match(/^\/v1\/ops\/orders\/([^/]+)\/confirm-children$/);
    if (req.method === 'POST' && opsConfirmMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const parentId = decodeURIComponent(opsConfirmMatch[1]!);
      const parent = await services.db.query<{ id: string }>(
        `SELECT id FROM app.parent_orders WHERE id = $1`,
        [parentId],
      );
      if (!parent.rows[0]) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      const actorIdentityId = await resolveOpsActor(services);
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      const children = await services.db.query<{ id: string }>(
        `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
        [parentId],
      );
      const wanted = new Set(body.childOrderIds ?? children.rows.map((c) => c.id));
      const confirmed: string[] = [];
      for (const child of children.rows) {
        if (!wanted.has(child.id)) continue;
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'confirmed',
          actorIdentityId,
          reason: 'local_ops_supplier_confirm',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          sendJson(res, 409, { error: result.reason, childOrderId: child.id });
          return;
        }
        confirmed.push(child.id);
      }
      const orders = await services.orders.listRecentOrders(50);
      sendJson(res, 200, { ok: true, confirmedChildIds: confirmed, orders });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/orders/split-shipments') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const requests = await services.orders.listSplitShipmentRequests(limit);
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/orders/split-shipments/mock-request') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        childOrderId?: string;
        child_order_id?: string;
        reason?: string;
        itemQuantities?: Array<{
          orderItemId?: string;
          order_item_id?: string;
          quantity?: number;
        }>;
        item_quantities?: Array<{
          orderItemId?: string;
          order_item_id?: string;
          quantity?: number;
        }>;
      }>(req);
      try {
        let childOrderId = (body.childOrderId ?? body.child_order_id)?.trim();
        if (!childOrderId) {
          const child = await services.db.query<{ id: string }>(
            `SELECT c.id FROM app.child_orders c
             JOIN app.order_items i ON i.child_order_id = c.id
             ORDER BY c.created_at DESC
             LIMIT 1`,
          );
          childOrderId = child.rows[0]?.id;
        }
        if (!childOrderId) {
          sendJson(res, 409, { error: 'no_child_order' });
          return;
        }

        let itemQuantities = (body.itemQuantities ?? body.item_quantities ?? [])
          .map((line) => ({
            orderItemId: (line.orderItemId ?? line.order_item_id ?? '').trim(),
            quantity:
              typeof line.quantity === 'number' && line.quantity > 0
                ? Math.floor(line.quantity)
                : 1,
          }))
          .filter((line) => line.orderItemId);

        if (itemQuantities.length === 0) {
          const item = await services.db.query<{ id: string }>(
            `SELECT id FROM app.order_items WHERE child_order_id = $1 ORDER BY created_at LIMIT 1`,
            [childOrderId],
          );
          if (!item.rows[0]) {
            sendJson(res, 409, { error: 'no_order_item' });
            return;
          }
          itemQuantities = [{ orderItemId: item.rows[0].id, quantity: 1 }];
        }

        const maker = await services.identity.ensureStaff(
          'staff:local-catalog-maker',
          'Catalog Maker',
          '+8562087000001',
        );
        const created = await services.orders.requestSplitShipment({
          childOrderId,
          makerIdentityId: maker.identityId,
          reason: body.reason?.trim() || 'local_mock_split_shipment',
          itemQuantities,
        });
        const requests = await services.orders.listSplitShipmentRequests(50);
        sendJson(res, 201, {
          ok: true,
          requestId: created.requestId,
          shipmentId: created.shipmentId,
          childOrderId,
          status: 'pending',
          requests,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'split_request_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const splitApproveMatch = url.pathname.match(
      /^\/v1\/ops\/orders\/split-shipments\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && splitApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const requestId = decodeURIComponent(splitApproveMatch[1]!);
      const body = await readJsonBody<{
        shipmentId?: string;
        shipment_id?: string;
      }>(req);
      try {
        let shipmentId = (body.shipmentId ?? body.shipment_id)?.trim();
        if (!shipmentId) {
          const linked = await services.db.query<{ shipment_id: string }>(
            `SELECT s.id AS shipment_id
             FROM app.split_shipment_requests r
             JOIN app.shipments s
               ON s.child_order_id = r.child_order_id AND s.requires_admin_approval = true
             WHERE r.id = $1
             ORDER BY s.created_at DESC
             LIMIT 1`,
            [requestId],
          );
          shipmentId = linked.rows[0]?.shipment_id;
        }
        if (!shipmentId) {
          sendJson(res, 404, { error: 'shipment_not_found' });
          return;
        }
        const makerRow = await services.db.query<{ maker_identity_id: string }>(
          `SELECT maker_identity_id FROM app.split_shipment_requests WHERE id = $1`,
          [requestId],
        );
        if (!makerRow.rows[0]) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        const owner = await services.identity.ensureStaff(
          'staff:local-catalog-owner',
          'Catalog Owner',
          '+8562087000002',
        );
        const approved = await services.orders.approveSplitShipment({
          requestId,
          shipmentId,
          approverIdentityId: owner.identityId,
          actorRoles: ['owner'],
        });
        const requests = await services.orders.listSplitShipmentRequests(50);
        if (!approved.ok) {
          const status =
            approved.reason === 'not_found'
              ? 404
              : approved.reason === 'self_approval' ||
                  approved.reason === 'not_pending' ||
                  approved.reason === 'admin_required'
                ? 409
                : 400;
          sendJson(res, status, { ok: false, error: approved.reason, requests });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          requestId,
          shipmentId,
          status: 'approved',
          requests,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'split_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const opsAdvanceMatch = url.pathname.match(
      /^\/v1\/ops\/orders\/([^/]+)\/fulfillment\/mock-advance$/,
    );
    if (req.method === 'POST' && opsAdvanceMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const parentId = decodeURIComponent(opsAdvanceMatch[1]!);
      const parent = await services.db.query<{ id: string }>(
        `SELECT id FROM app.parent_orders WHERE id = $1`,
        [parentId],
      );
      if (!parent.rows[0]) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const children = await mockAdvanceFulfillment(services, parentId, actorIdentityId);
        const orders = await services.orders.listRecentOrders(50);
        sendJson(res, 200, { ok: true, children, orders });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fulfillment_advance_failed';
        sendJson(res, message === 'mock_courier_missing' ? 500 : 400, { error: message });
      }
      return;
    }

    const opsDeliverMatch = url.pathname.match(
      /^\/v1\/ops\/orders\/([^/]+)\/fulfillment\/mock-deliver$/,
    );
    if (req.method === 'POST' && opsDeliverMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const parentId = decodeURIComponent(opsDeliverMatch[1]!);
      const parent = await services.db.query<{ id: string }>(
        `SELECT id FROM app.parent_orders WHERE id = $1`,
        [parentId],
      );
      if (!parent.rows[0]) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const children = await mockDeliverFulfillment(services, parentId, actorIdentityId);
        const orders = await services.orders.listRecentOrders(50);
        sendJson(res, 200, { ok: true, children, orders });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fulfillment_deliver_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const orderMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (req.method === 'GET' && orderMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(orderMatch[1]!);
      const owner = await services.db.query<{ customer_identity_id: string }>(
        `SELECT customer_identity_id FROM app.parent_orders WHERE id = $1`,
        [parentId],
      );
      const row = owner.rows[0];
      if (!row) {
        sendJson(res, 404, { error: 'order_not_found' });
        return;
      }
      if (row.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const views = await services.orders.getOrderViews(parentId);
      sendJson(res, 200, { ok: true, ...views });
      return;
    }

    const confirmChildrenMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/confirm-children$/);
    if (req.method === 'POST' && confirmChildrenMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(confirmChildrenMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      const children = await services.db.query<{ id: string }>(
        `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
        [parentId],
      );
      const wanted = new Set(body.childOrderIds ?? children.rows.map((c) => c.id));
      const confirmed: string[] = [];
      for (const child of children.rows) {
        if (!wanted.has(child.id)) continue;
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'confirmed',
          actorIdentityId: session.identityId,
          reason: 'local_mock_supplier_confirm',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          sendJson(res, 409, { error: result.reason, childOrderId: child.id });
          return;
        }
        confirmed.push(child.id);
      }
      sendJson(res, 200, { ok: true, confirmedChildIds: confirmed });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(cancelMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ scope?: 'order' | 'store'; childOrderId?: string }>(req);
      const scope = body.scope === 'store' ? 'store' : 'order';
      if (scope === 'store' && !body.childOrderId) {
        sendJson(res, 400, { error: 'child_order_id_required' });
        return;
      }
      try {
        const result = await cancelOrderBeforeHandoff(
          services,
          parentId,
          session.identityId,
          scope,
          body.childOrderId,
        );
        const views = await services.orders.getOrderViews(parentId);
        sendJson(res, 200, { ok: true, ...result, order: views });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'cancel_failed';
        sendJson(
          res,
          message === 'use_refusal_or_return_workflow' || message === 'parent_not_found'
            ? 409
            : 400,
          { error: message },
        );
      }
      return;
    }

    const createQrMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/payments\/qr$/);
    if (req.method === 'POST' && createQrMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(createQrMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      let childOrderIds = body.childOrderIds;
      if (!childOrderIds || childOrderIds.length === 0) {
        const children = await services.db.query<{ id: string }>(
          `SELECT id FROM app.child_orders WHERE parent_order_id = $1`,
          [parentId],
        );
        childOrderIds = children.rows.map((c) => c.id);
      }
      try {
        const qr = await services.payments.createQrPaymentRequest({
          parentOrderId: parentId,
          childOrderIds,
          actorIdentityId: session.identityId,
        });

        const lines = await services.db.query<{
          id: string;
          variant_id: string;
          store_id: string;
          quantity: number;
        }>(
          `SELECT oi.id, oi.variant_id, oi.store_id, oi.quantity
           FROM app.order_items oi
           JOIN app.child_orders co ON co.id = oi.child_order_id
           WHERE co.parent_order_id = $1
             AND co.id = ANY($2::uuid[])
             AND oi.status = 'active'`,
          [parentId, childOrderIds],
        );

        const paymentDeadlineAt = Date.parse(qr.expiresAt);
        const correlationId = crypto.randomUUID();
        const reservations: Array<{
          orderItemId: string;
          reservationId: string;
          balanceId: string;
          quantity: number;
        }> = [];

        for (const line of lines.rows) {
          const balanceId = await services.inventory.pickBalanceForReserve({
            storeId: line.store_id,
            variantId: line.variant_id,
            quantity: line.quantity,
          });
          if (!balanceId) {
            for (const reserved of reservations) {
              await services.reservations.release({
                reservationId: reserved.reservationId,
                correlationId,
                reason: 'qr_reserve_rollback',
              });
            }
            await services.db.query(
              `UPDATE finance.payment_requests SET status = 'cancelled' WHERE id = $1 AND status = 'open'`,
              [qr.paymentRequestId],
            );
            sendJson(res, 409, {
              error: 'insufficient_available',
              orderItemId: line.id,
              variantId: line.variant_id,
            });
            return;
          }
          const reserved = await services.reservations.reserve({
            balanceId,
            quantity: line.quantity,
            reservationType: 'qr',
            paymentDeadlineAt,
            idempotencyKey: `qr:${qr.paymentRequestId}:${line.id}`,
            correlationId,
          });
          if (!reserved.ok) {
            for (const prev of reservations) {
              await services.reservations.release({
                reservationId: prev.reservationId,
                correlationId,
                reason: 'qr_reserve_rollback',
              });
            }
            await services.db.query(
              `UPDATE finance.payment_requests SET status = 'cancelled' WHERE id = $1 AND status = 'open'`,
              [qr.paymentRequestId],
            );
            sendJson(res, 409, {
              error: reserved.reason,
              orderItemId: line.id,
              variantId: line.variant_id,
            });
            return;
          }
          reservations.push({
            orderItemId: line.id,
            reservationId: reserved.reservationId,
            balanceId,
            quantity: line.quantity,
          });
        }

        sendJson(res, 201, { ok: true, ...qr, reservations });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'qr_create_failed';
        sendJson(res, message === 'qr_requires_supplier_confirmation' ? 409 : 400, {
          error: message,
        });
      }
      return;
    }

    const createCodMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/payments\/cod$/);
    if (req.method === 'POST' && createCodMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(createCodMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      const body = await readJsonBody<{ childOrderIds?: string[] }>(req);
      const children = await services.db.query<{
        id: string;
        status: string;
        total_lak: number;
      }>(
        `SELECT id, status, total_lak FROM app.child_orders WHERE parent_order_id = $1`,
        [parentId],
      );
      const wanted = new Set(
        body.childOrderIds && body.childOrderIds.length > 0
          ? body.childOrderIds
          : children.rows.map((c) => c.id),
      );
      const shipments: Array<{
        childOrderId: string;
        codShipmentId: string;
        amountLak: number;
        depositLak: number;
        balanceDueLak: number;
      }> = [];
      const reservations: Array<{
        orderItemId: string;
        childOrderId: string;
        reservationId: string;
        balanceId: string;
        quantity: number;
      }> = [];
      const correlationId = crypto.randomUUID();

      for (const child of children.rows) {
        if (!wanted.has(child.id)) continue;
        if (!['confirmed', 'partial_confirmed', 'awaiting_cod'].includes(child.status)) {
          sendJson(res, 409, {
            error: 'cod_requires_supplier_confirmation',
            childOrderId: child.id,
            status: child.status,
          });
          return;
        }

        const amountLak = Number(child.total_lak);
        const childReservations: typeof reservations = [];
        const lines = await services.db.query<{
          id: string;
          variant_id: string;
          store_id: string;
          quantity: number;
        }>(
          `SELECT id, variant_id, store_id, quantity
           FROM app.order_items
           WHERE child_order_id = $1 AND status = 'active'`,
          [child.id],
        );
        for (const line of lines.rows) {
          const balanceId = await services.inventory.pickBalanceForReserve({
            storeId: line.store_id,
            variantId: line.variant_id,
            quantity: line.quantity,
          });
          if (!balanceId) {
            for (const reserved of [...reservations, ...childReservations]) {
              await services.reservations.release({
                reservationId: reserved.reservationId,
                correlationId,
                reason: 'cod_reserve_rollback',
              });
            }
            sendJson(res, 409, {
              error: 'insufficient_available',
              orderItemId: line.id,
              variantId: line.variant_id,
            });
            return;
          }
          const reserved = await services.reservations.reserve({
            balanceId,
            quantity: line.quantity,
            reservationType: 'cod',
            idempotencyKey: `cod:${child.id}:${line.id}`,
            correlationId,
          });
          if (!reserved.ok) {
            for (const prev of [...reservations, ...childReservations]) {
              await services.reservations.release({
                reservationId: prev.reservationId,
                correlationId,
                reason: 'cod_reserve_rollback',
              });
            }
            sendJson(res, 409, {
              error: reserved.reason,
              orderItemId: line.id,
              variantId: line.variant_id,
            });
            return;
          }
          childReservations.push({
            orderItemId: line.id,
            childOrderId: child.id,
            reservationId: reserved.reservationId,
            balanceId,
            quantity: line.quantity,
          });
        }

        const existing = await services.db.query<{
          id: string;
          amount_lak: number;
          deposit_lak: number;
          balance_due_lak: number;
        }>(
          `SELECT id, amount_lak, deposit_lak, balance_due_lak
           FROM finance.cod_shipments
           WHERE child_order_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [child.id],
        );
        let codShipmentId = existing.rows[0]?.id;
        let depositLak = existing.rows[0] ? Number(existing.rows[0].deposit_lak) : 0;
        let balanceDueLak = existing.rows[0] ? Number(existing.rows[0].balance_due_lak) : 0;

        if (!codShipmentId) {
          const created = await services.payments.createCodShipment({
            customerIdentityId: session.identityId,
            childOrderId: child.id,
            amountLak,
            phoneVerified: true,
          });
          if (!created.ok) {
            for (const reserved of [...reservations, ...childReservations]) {
              await services.reservations.release({
                reservationId: reserved.reservationId,
                correlationId,
                reason: 'cod_reserve_rollback',
              });
            }
            sendJson(res, 409, { error: created.reason, childOrderId: child.id });
            return;
          }
          codShipmentId = created.codShipmentId;
          depositLak = created.depositLak;
          balanceDueLak = created.balanceDueLak;
        }

        reservations.push(...childReservations);
        shipments.push({
          childOrderId: child.id,
          codShipmentId,
          amountLak,
          depositLak,
          balanceDueLak,
        });
      }

      if (shipments.length === 0) {
        sendJson(res, 400, { error: 'no_children' });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        shipments,
        reservations,
        totalDepositLak: shipments.reduce((s, x) => s + x.depositLak, 0),
        totalBalanceDueLak: shipments.reduce((s, x) => s + x.balanceDueLak, 0),
      });
      return;
    }

    const paymentMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (req.method === 'GET' && paymentMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const paymentRequestId = decodeURIComponent(paymentMatch[1]!);
      const row = await services.db.query<{
        id: string;
        parent_order_id: string;
        reference_code: string;
        method: string;
        amount_lak: number;
        status: string;
        expires_at: string;
        customer_identity_id: string;
      }>(
        `SELECT pr.id, pr.parent_order_id, pr.reference_code, pr.method,
                pr.amount_lak, pr.status, pr.expires_at::text,
                po.customer_identity_id
         FROM finance.payment_requests pr
         JOIN app.parent_orders po ON po.id = pr.parent_order_id
         WHERE pr.id = $1`,
        [paymentRequestId],
      );
      const payment = row.rows[0];
      if (!payment) {
        sendJson(res, 404, { error: 'payment_not_found' });
        return;
      }
      if (payment.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'payment_forbidden' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        payment: {
          paymentRequestId: payment.id,
          parentOrderId: payment.parent_order_id,
          referenceCode: payment.reference_code,
          method: payment.method,
          amountLak: Number(payment.amount_lak),
          status: payment.status,
          expiresAt: payment.expires_at,
        },
      });
      return;
    }

    const mockConfirmMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)\/mock-confirm$/);
    if (req.method === 'POST' && mockConfirmMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const paymentRequestId = decodeURIComponent(mockConfirmMatch[1]!);
      const owned = await services.db.query<{
        amount_lak: number;
        customer_identity_id: string;
        reference_code: string;
      }>(
        `SELECT pr.amount_lak, po.customer_identity_id, pr.reference_code
         FROM finance.payment_requests pr
         JOIN app.parent_orders po ON po.id = pr.parent_order_id
         WHERE pr.id = $1`,
        [paymentRequestId],
      );
      const payment = owned.rows[0];
      if (!payment) {
        sendJson(res, 404, { error: 'payment_not_found' });
        return;
      }
      if (payment.customer_identity_id !== session.identityId) {
        sendJson(res, 403, { error: 'payment_forbidden' });
        return;
      }
      const amountLak = Number(payment.amount_lak);
      const evidence = await services.payments.submitEvidence({
        paymentRequestId,
        amountReportedLak: amountLak,
        evidenceStorageKey: `mock/evidence/${paymentRequestId}.png`,
        idempotencyKey: `mock-evidence-${paymentRequestId}`,
      });
      const confirmed = await services.payments.confirmPayment({
        paymentRequestId,
        attemptId: evidence.attemptId,
        channel: 'manual',
        amountLak,
        bankRef: `MOCK-${payment.reference_code}`,
        idempotencyKey: `mock-confirm-${paymentRequestId}`,
        actorIdentityId: session.identityId,
      });
      if (!confirmed.ok) {
        sendJson(res, 409, { error: confirmed.reason });
        return;
      }
      sendJson(res, 200, { ok: true, paymentRequestId, status: 'paid' });
      return;
    }

    const mockFulfillMatch = url.pathname.match(
      /^\/v1\/orders\/([^/]+)\/fulfillment\/mock-advance$/,
    );
    if (req.method === 'POST' && mockFulfillMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(mockFulfillMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      try {
        const children = await mockAdvanceFulfillment(
          services,
          parentId,
          session.identityId,
        );
        const views = await services.orders.getOrderViews(parentId);
        sendJson(res, 200, { ok: true, children, order: views });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fulfillment_advance_failed';
        sendJson(res, message === 'mock_courier_missing' ? 500 : 400, { error: message });
      }
      return;
    }

    const mockDeliverMatch = url.pathname.match(
      /^\/v1\/orders\/([^/]+)\/fulfillment\/mock-deliver$/,
    );
    if (req.method === 'POST' && mockDeliverMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const parentId = decodeURIComponent(mockDeliverMatch[1]!);
      if (!(await parentOwnedBy(services, parentId, session.identityId))) {
        sendJson(res, 403, { error: 'order_forbidden' });
        return;
      }
      try {
        const children = await mockDeliverFulfillment(
          services,
          parentId,
          session.identityId,
        );
        const views = await services.orders.getOrderViews(parentId);
        sendJson(res, 200, { ok: true, children, order: views });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fulfillment_deliver_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/payments/mock-expire-due') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{ now?: string }>(req);
      const now = body.now ? new Date(body.now) : new Date();
      if (Number.isNaN(now.getTime())) {
        sendJson(res, 400, { error: 'invalid_now' });
        return;
      }
      try {
        const result = await mockExpireDue(services, now, session.identityId);
        sendJson(res, 200, { ok: true, now: now.toISOString(), ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'expire_due_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/me/privacy') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      try {
        const [profile, addresses] = await Promise.all([
          services.privacy.getProfile(session.identityId),
          services.privacy.listAddresses(session.identityId),
        ]);
        sendJson(res, 200, { ok: true, profile, addresses });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'privacy_profile_failed';
        sendJson(res, message === 'customer_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/addresses') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        label?: string;
        recipientName?: string;
        recipient_name?: string;
        recipientPhoneE164?: string;
        recipient_phone_e164?: string;
        addressLine?: string;
        address_line?: string;
        district?: string;
        province?: string;
        isDefault?: boolean;
        is_default?: boolean;
      }>(req);
      const recipientName = body.recipientName ?? body.recipient_name;
      const recipientPhoneE164 = body.recipientPhoneE164 ?? body.recipient_phone_e164;
      const addressLine = body.addressLine ?? body.address_line;
      if (!recipientName?.trim() || !recipientPhoneE164?.trim() || !addressLine?.trim()) {
        sendJson(res, 400, { error: 'invalid_address' });
        return;
      }
      try {
        const addressId = await services.privacy.addAddress({
          customerIdentityId: session.identityId,
          label: body.label,
          recipientName: recipientName.trim(),
          recipientPhoneE164: recipientPhoneE164.trim(),
          addressLine: addressLine.trim(),
          district: body.district,
          province: body.province,
          isDefault: body.isDefault ?? body.is_default,
        });
        const addresses = await services.privacy.listAddresses(session.identityId);
        sendJson(res, 201, { ok: true, addressId, addresses });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'address_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/marketing-opt-in') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{ optIn?: boolean; opt_in?: boolean }>(req);
      const optIn = body.optIn ?? body.opt_in;
      if (typeof optIn !== 'boolean') {
        sendJson(res, 400, { error: 'opt_in_required' });
        return;
      }
      try {
        await services.privacy.setMarketingOptIn(session.identityId, optIn);
        const profile = await services.privacy.getProfile(session.identityId);
        sendJson(res, 200, { ok: true, profile });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'marketing_opt_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/deletion-request') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{ otpVerified?: boolean; otp_verified?: boolean }>(req);
      // Local/mock: authenticated session counts as OTP-verified gate for deletion request.
      const otpVerified = body.otpVerified ?? body.otp_verified ?? true;
      try {
        const requestId = await services.privacy.requestDeletion({
          customerIdentityId: session.identityId,
          otpVerified,
        });
        sendJson(res, 201, { ok: true, requestId, status: 'pending' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'deletion_request_failed';
        sendJson(res, message === 'otp_required' ? 403 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/phone-change/start') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        newPhone?: string;
        new_phone?: string;
        oldPhone?: string;
        old_phone?: string;
      }>(req);
      const newPhone = (body.newPhone ?? body.new_phone)?.trim();
      if (!newPhone || !/^\+[1-9]\d{7,14}$/.test(newPhone)) {
        sendJson(res, 400, { error: 'invalid_new_phone' });
        return;
      }
      try {
        const profile = await services.privacy.getProfile(session.identityId);
        const oldPhone = (body.oldPhone ?? body.old_phone)?.trim() || profile.phoneE164;
        if (!oldPhone || !/^\+[1-9]\d{7,14}$/.test(oldPhone)) {
          sendJson(res, 400, { error: 'invalid_old_phone' });
          return;
        }
        if (profile.phoneE164 && oldPhone !== profile.phoneE164) {
          sendJson(res, 403, { error: 'old_phone_mismatch' });
          return;
        }
        if (oldPhone === newPhone) {
          sendJson(res, 400, { error: 'phone_unchanged' });
          return;
        }
        const started = await services.privacy.startPhoneChange({
          customerIdentityId: session.identityId,
          oldPhone,
          newPhone,
        });
        const payload: Record<string, unknown> = {
          ok: true,
          correlationId: started.correlationId,
        };
        // Local/mock only — never expose dual OTP codes outside local APP_ENV
        if (env.APP_ENV === 'local' && env.INTEGRATIONS_MODE === 'mock') {
          payload.devOldCode = started.oldCode;
          payload.devNewCode = started.newCode;
        }
        sendJson(res, 200, payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'phone_change_start_failed';
        sendJson(res, message === 'customer_not_found' ? 404 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/phone-change/confirm') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        correlationId?: string;
        correlation_id?: string;
        oldCode?: string;
        old_code?: string;
        newCode?: string;
        new_code?: string;
      }>(req);
      const correlationId = (body.correlationId ?? body.correlation_id)?.trim();
      const oldCode = (body.oldCode ?? body.old_code)?.trim();
      const newCode = (body.newCode ?? body.new_code)?.trim();
      if (!correlationId || !oldCode || !newCode) {
        sendJson(res, 400, { error: 'correlation_and_codes_required' });
        return;
      }
      try {
        await services.privacy.confirmPhoneChange({
          correlationId,
          oldCode,
          newCode,
          customerIdentityId: session.identityId,
        });
        const profile = await services.privacy.getProfile(session.identityId);
        sendJson(res, 200, { ok: true, profile });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'phone_change_confirm_failed';
        const status =
          message === 'otp_invalid'
            ? 403
            : message === 'phone_change_challenges_missing'
              ? 409
              : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/me/recovery-document') {
      const body = await readJsonBody<{
        claimedPhone?: string;
        claimed_phone?: string;
        documentStorageKey?: string;
        document_storage_key?: string;
      }>(req);
      const claimedPhone = (body.claimedPhone ?? body.claimed_phone)?.trim();
      const documentStorageKey = (
        body.documentStorageKey ??
        body.document_storage_key ??
        'private/recovery/local-mock.pdf'
      ).trim();
      if (!claimedPhone || !/^\+[1-9]\d{7,14}$/.test(claimedPhone)) {
        sendJson(res, 400, { error: 'invalid_claimed_phone' });
        return;
      }
      try {
        const requestId = await services.privacy.submitRecoveryDocument({
          claimedPhone,
          documentStorageKey,
        });
        sendJson(res, 201, { ok: true, requestId, status: 'pending' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'recovery_submit_failed';
        sendJson(res, message === 'recovery_doc_must_be_private' ? 400 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/privacy/deletion-requests') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const requests = await services.privacy.listDeletionRequests(limit);
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/privacy/recovery-requests') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const requests = await services.privacy.listRecoveryRequests(limit);
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    const deletionApproveMatch = url.pathname.match(
      /^\/v1\/ops\/privacy\/deletion-requests\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && deletionApproveMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const requestId = decodeURIComponent(deletionApproveMatch[1]!);
      try {
        const approverIdentityId = await resolveOpsActor(services);
        await services.privacy.approveAndAnonymizeDeletion({
          requestId,
          approverIdentityId,
        });
        const requests = await services.privacy.listDeletionRequests(50);
        sendJson(res, 200, { ok: true, requestId, status: 'completed', requests });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'deletion_approve_failed';
        sendJson(res, message === 'deletion_not_pending' ? 409 : 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/reviews') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const productId = url.searchParams.get('productId')?.trim() || undefined;
      const reviews = await services.content.listReviews({ productId, limit });
      sendJson(res, 200, { ok: true, reviews });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/reviews') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        productId?: string;
        product_id?: string;
        childOrderId?: string;
        child_order_id?: string;
        rating?: number;
        bodyLo?: string;
        body_lo?: string;
        bodyEn?: string;
        body_en?: string;
      }>(req);
      const productId = body.productId ?? body.product_id;
      const childOrderId = body.childOrderId ?? body.child_order_id;
      const rating = body.rating;
      if (!productId || !childOrderId || typeof rating !== 'number' || rating < 1 || rating > 5) {
        sendJson(res, 400, { error: 'invalid_review' });
        return;
      }
      try {
        const created = await services.content.createReview({
          productId,
          childOrderId,
          customerIdentityId: session.identityId,
          rating,
          bodyLo: body.bodyLo ?? body.body_lo,
          bodyEn: body.bodyEn ?? body.body_en,
        });
        const reviews = await services.content.listReviews({ limit: 50 });
        sendJson(res, 201, { ok: true, ...created, reviews });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'review_create_failed';
        const status =
          message === 'not_order_owner' || message === 'not_verified_purchase'
            ? 403
            : message === 'review_requires_delivered' || message === 'review_window_exceeded'
              ? 409
              : message === 'child_order_not_found'
                ? 404
                : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    const reviewEditMatch = url.pathname.match(/^\/v1\/reviews\/([^/]+)$/);
    if (req.method === 'PATCH' && reviewEditMatch) {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const reviewId = decodeURIComponent(reviewEditMatch[1]!);
      const body = await readJsonBody<{
        rating?: number;
        bodyLo?: string;
        body_lo?: string;
        bodyEn?: string;
        body_en?: string;
      }>(req);
      const rating = body.rating;
      if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        sendJson(res, 400, { error: 'invalid_review' });
        return;
      }
      try {
        const edited = await services.content.editReview({
          reviewId,
          customerIdentityId: session.identityId,
          rating,
          bodyLo: body.bodyLo ?? body.body_lo,
          bodyEn: body.bodyEn ?? body.body_en,
        });
        const reviews = await services.content.listReviews({ limit: 50 });
        sendJson(res, 200, { ok: true, reviewId, ...edited, reviews });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'review_edit_failed';
        const status =
          message === 'not_review_owner'
            ? 403
            : message === 'review_edit_window_exceeded'
              ? 409
              : message === 'review_not_found'
                ? 404
                : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/reviews/responses') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const reviewId = url.searchParams.get('reviewId')?.trim() || undefined;
      const responses = await services.content.listSupplierResponses({ reviewId, limit });
      sendJson(res, 200, { ok: true, responses });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/tiktok-links') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const links = await services.content.listTikTokLinks(limit);
      sendJson(res, 200, { ok: true, links });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/tiktok-links') {
      const session = await requireCustomerSession(req, services);
      if (!session) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody<{
        url?: string;
        productId?: string;
        product_id?: string;
      }>(req);
      const linkUrl = body.url?.trim();
      if (!linkUrl) {
        sendJson(res, 400, { error: 'url_required' });
        return;
      }
      try {
        const created = await services.content.submitTikTokLink({
          url: linkUrl,
          productId: body.productId ?? body.product_id,
          submittedByType: 'customer',
          submittedBy: session.identityId,
        });
        const links = await services.content.listTikTokLinks(50);
        sendJson(res, 201, { ok: true, ...created, links });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'tiktok_submit_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/reviews/mock-create') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        rating?: number;
        body_en?: string;
        bodyEn?: string;
      }>(req);
      try {
        const product = await services.db.query<{
          product_id: string;
          variant_id: string;
          store_id: string;
        }>(
          `SELECT pv.product_id, pv.id AS variant_id, pv.store_id
           FROM app.product_variants pv
           JOIN app.products p ON p.id = pv.product_id
           WHERE p.status = 'active' AND pv.status = 'active'
           ORDER BY p.created_at
           LIMIT 1`,
        );
        const sell = product.rows[0];
        if (!sell) {
          sendJson(res, 409, { error: 'no_active_product' });
          return;
        }
        const customerId = await services.identity.ensureCustomer(
          '+8562097222039',
          'Review QA',
        );
        const cartId = await services.orders.createCart(customerId);
        await services.orders.addCartItem(cartId, {
          storeId: sell.store_id,
          variantId: sell.variant_id,
          quantity: 1,
        });
        const createdOrder = await services.orders.checkout({
          cartId,
          customerIdentityId: customerId,
          actorIdentityId: customerId,
          correlationId: crypto.randomUUID(),
          shippingLakByStore: { [sell.store_id]: 10000 },
        });
        const childOrderId = createdOrder.childIds[0]!;
        await services.db.query(
          `UPDATE app.child_orders
           SET status = 'delivered', payment_received = true, updated_at = timezone('utc', now())
           WHERE id = $1`,
          [childOrderId],
        );
        const created = await services.content.createReview({
          productId: sell.product_id,
          childOrderId,
          customerIdentityId: customerId,
          rating:
            typeof body.rating === 'number' && body.rating >= 1 && body.rating <= 5
              ? body.rating
              : 5,
          bodyEn: body.bodyEn ?? body.body_en ?? 'Local mock review',
        });
        const reviews = await services.content.listReviews({ limit: 50 });
        sendJson(res, 201, {
          ok: true,
          ...created,
          productId: sell.product_id,
          childOrderId,
          reviews,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'review_mock_create_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const supplierResponseMatch = url.pathname.match(
      /^\/v1\/ops\/reviews\/([^/]+)\/supplier-response$/,
    );
    if (req.method === 'POST' && supplierResponseMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const reviewId = decodeURIComponent(supplierResponseMatch[1]!);
      const body = await readJsonBody<{
        body?: string;
        storeId?: string;
        store_id?: string;
      }>(req);
      const responseBody = body.body?.trim();
      if (!responseBody) {
        sendJson(res, 400, { error: 'body_required' });
        return;
      }
      try {
        let storeId = (body.storeId ?? body.store_id)?.trim();
        if (!storeId) {
          const store = await services.db.query<{ store_id: string }>(
            `SELECT pv.store_id
             FROM app.product_reviews r
             JOIN app.product_variants pv ON pv.product_id = r.product_id
             WHERE r.id = $1
             LIMIT 1`,
            [reviewId],
          );
          storeId = store.rows[0]?.store_id;
        }
        if (!storeId) {
          sendJson(res, 404, { error: 'review_store_not_found' });
          return;
        }
        const created = await services.content.submitSupplierResponse({
          reviewId,
          storeId,
          body: responseBody,
        });
        const responses = await services.content.listSupplierResponses({ limit: 50 });
        sendJson(res, 201, { ok: true, ...created, responses });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'supplier_response_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const approveResponseMatch = url.pathname.match(
      /^\/v1\/ops\/reviews\/responses\/([^/]+)\/approve$/,
    );
    if (req.method === 'POST' && approveResponseMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const responseId = decodeURIComponent(approveResponseMatch[1]!);
      try {
        const approverIdentityId = await resolveOpsActor(services);
        await services.content.approveSupplierResponse({
          responseId,
          approverIdentityId,
        });
        const responses = await services.content.listSupplierResponses({ limit: 50 });
        sendJson(res, 200, { ok: true, responseId, status: 'approved', responses });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'supplier_response_approve_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/tiktok-links/mock-submit') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{
        url?: string;
        productId?: string;
        product_id?: string;
        as?: 'staff' | 'supplier' | 'customer';
      }>(req);
      const linkUrl =
        body.url?.trim() ||
        `https://www.tiktok.com/@bombee/video/${Date.now().toString().slice(-8)}`;
      try {
        const actorIdentityId = await resolveOpsActor(services);
        const created = await services.content.submitTikTokLink({
          url: linkUrl,
          productId: body.productId ?? body.product_id,
          submittedByType: body.as ?? 'supplier',
          submittedBy: actorIdentityId,
        });
        const links = await services.content.listTikTokLinks(50);
        sendJson(res, 201, { ok: true, ...created, links });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'tiktok_mock_submit_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    const tiktokModerateMatch = url.pathname.match(
      /^\/v1\/ops\/tiktok-links\/([^/]+)\/moderate$/,
    );
    if (req.method === 'POST' && tiktokModerateMatch) {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const linkId = decodeURIComponent(tiktokModerateMatch[1]!);
      const body = await readJsonBody<{ approve?: boolean }>(req);
      if (typeof body.approve !== 'boolean') {
        sendJson(res, 400, { error: 'approve_required' });
        return;
      }
      try {
        const actorIdentityId = await resolveOpsActor(services);
        await services.content.moderateTikTok({
          linkId,
          approve: body.approve,
          actorIdentityId,
        });
        const links = await services.content.listTikTokLinks(50);
        sendJson(res, 200, {
          ok: true,
          linkId,
          status: body.approve ? 'published' : 'rejected',
          links,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'tiktok_moderate_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/search/catalog') {
      const q = url.searchParams.get('q')?.trim() || undefined;
      const barcode = url.searchParams.get('barcode')?.trim() || undefined;
      if (!q && !barcode) {
        sendJson(res, 400, { error: 'q_or_barcode_required' });
        return;
      }
      const matches = await services.imageSearch.searchCatalog({
        ocrText: q,
        barcodeValue: barcode,
      });
      sendJson(res, 200, { ok: true, matches });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/search/image') {
      const body = await readJsonBody<{
        contentType?: string;
        content_type?: string;
        byteSize?: number;
        byte_size?: number;
        consentSearchOnly?: boolean;
        consent_search_only?: boolean;
        consentTrainAnalytics?: boolean;
        ocrText?: string;
        ocr_text?: string;
        barcodeValue?: string;
        barcode_value?: string;
      }>(req);
      const session = await requireCustomerSession(req, services);
      try {
        const contentType = body.contentType ?? body.content_type ?? 'image/jpeg';
        const byteSize = body.byteSize ?? body.byte_size ?? 1024;
        const consentSearchOnly = body.consentSearchOnly ?? body.consent_search_only ?? true;
        const upload = await services.imageSearch.upload({
          customerIdentityId: session?.identityId,
          contentType,
          byteSize,
          consentSearchOnly,
          consentTrainAnalytics: body.consentTrainAnalytics === true,
          ocrText: body.ocrText ?? body.ocr_text,
          barcodeValue: body.barcodeValue ?? body.barcode_value,
        });
        const matches = await services.imageSearch.searchCatalog({
          ocrText: body.ocrText ?? body.ocr_text,
          barcodeValue: body.barcodeValue ?? body.barcode_value,
        });
        sendJson(res, 201, { ok: true, upload, matches });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'image_search_failed';
        const status =
          message === 'invalid_content_type' ||
          message === 'file_too_large' ||
          message === 'search_consent_required' ||
          message === 'train_analytics_consent_forbidden'
            ? 400
            : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/search/uploads') {
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const uploads = await services.imageSearch.listUploads(limit);
      sendJson(res, 200, { ok: true, uploads });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/ops/search/purge-expired') {
      if (!mockOpsAllowed(env)) {
        sendJson(res, 403, { error: 'mock_ops_disabled' });
        return;
      }
      const body = await readJsonBody<{ now?: string }>(req);
      let now = new Date();
      if (body.now) {
        const parsed = Date.parse(body.now);
        if (!Number.isFinite(parsed)) {
          sendJson(res, 400, { error: 'invalid_now' });
          return;
        }
        now = new Date(parsed);
      }
      try {
        const purged = await services.imageSearch.purgeExpired(now);
        const uploads = await services.imageSearch.listUploads(50);
        sendJson(res, 200, { ok: true, ...purged, uploads });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'search_purge_failed';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(res, 200, {
        name: BRAND_NAME,
        currency: CURRENCY_CODE,
        timezone: DISPLAY_TIMEZONE,
        env: env.APP_ENV,
        egoPosEnabled: env.EGO_POS_ENABLED,
        inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
        integrationsMode: env.INTEGRATIONS_MODE,
        productionDeployAuthorized: env.OWNER_PRODUCTION_DEPLOY_APPROVED,
        productionHold: !env.OWNER_PRODUCTION_DEPLOY_APPROVED,
      });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(Buffer.byteLength(payload)));
  res.end(payload);
}

async function requireCustomerSession(req: IncomingMessage, services: ApiServices) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  const session = await services.identity.getSession(token);
  if (!session || session.audience !== 'customer') return null;
  return session;
}

async function cartOwnedBy(services: ApiServices, cartId: string, identityId: string) {
  const row = await services.db.query<{ customer_identity_id: string }>(
    `SELECT customer_identity_id FROM app.carts WHERE id = $1`,
    [cartId],
  );
  return row.rows[0]?.customer_identity_id === identityId;
}

async function parentOwnedBy(services: ApiServices, parentId: string, identityId: string) {
  const row = await services.db.query<{ customer_identity_id: string }>(
    `SELECT customer_identity_id FROM app.parent_orders WHERE id = $1`,
    [parentId],
  );
  return row.rows[0]?.customer_identity_id === identityId;
}

function mockOpsAllowed(env: BombeeEnv): boolean {
  return env.INTEGRATIONS_MODE === 'mock' || env.APP_ENV === 'local';
}

async function resolveOpsActor(services: ApiServices): Promise<string> {
  const existing = await services.db.query<{ id: string }>(
    `SELECT id FROM security.auth_identities
     WHERE subject IN ('staff:local-catalog-owner', 'staff:local-ops')
     ORDER BY subject
     LIMIT 1`,
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await services.identity.ensureStaff(
    'staff:local-ops',
    'Local Ops',
    '+8562087000099',
  );
  return created.identityId;
}

/** Distinct from maker for settlement maker-checker (local mock). */
async function resolveOpsApprover(
  services: ApiServices,
  makerIdentityId: string,
): Promise<string> {
  const existing = await services.db.query<{ id: string }>(
    `SELECT id FROM security.auth_identities
     WHERE subject IN ('staff:local-catalog-maker', 'staff:local-finance')
       AND id <> $1
     ORDER BY subject
     LIMIT 1`,
    [makerIdentityId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await services.identity.ensureStaff(
    'staff:local-finance',
    'Local Finance',
    '+8562087000098',
  );
  if (created.identityId === makerIdentityId) {
    const other = await services.identity.ensureStaff(
      'staff:local-finance-approver',
      'Local Finance Approver',
      '+8562087000097',
    );
    return other.identityId;
  }
  return created.identityId;
}
