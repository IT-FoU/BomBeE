import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME, CURRENCY_CODE, DISPLAY_TIMEZONE } from '@bombee/shared';

import { getHealth } from './modules/system/health.js';

export function createAppRouter(env: BombeeEnv) {
  return async function appRouter(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
