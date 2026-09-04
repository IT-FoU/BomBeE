import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME, CURRENCY_CODE, DISPLAY_TIMEZONE } from '@bombee/shared';

import { readJsonBody } from './http/readJsonBody.js';
import { applyCors } from './http/cors.js';
import { getHealth } from './modules/system/health.js';
import type { ApiServices } from './runtime/createServices.js';
import { InviteService, evaluateInviteAccess } from './modules/staging/inviteService.js';

export function createAppRouter(env: BombeeEnv, services: ApiServices) {
  const invites = new InviteService(services.db);

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
        const invite = await invites.findByCode(inviteCode);
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
      const body = await readJsonBody<{ phoneE164?: string; code?: string; purpose?: string }>(
        req,
      );
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
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
