import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME } from '@bombee/shared';

export type HealthResponse = {
  status: 'ok';
  service: string;
  env: BombeeEnv['APP_ENV'];
  egoPosEnabled: boolean;
  inviteOnlyEnabled: boolean;
  integrationsMode: BombeeEnv['INTEGRATIONS_MODE'];
  productionHold: boolean;
  timestamp: string;
};

export function getHealth(env: BombeeEnv): HealthResponse {
  return {
    status: 'ok',
    service: BRAND_NAME,
    env: env.APP_ENV,
    egoPosEnabled: env.EGO_POS_ENABLED,
    inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
    integrationsMode: env.INTEGRATIONS_MODE,
    /** Phase 1: Production deploy remains Owner-gated regardless of APP_ENV. */
    productionHold: true,
    timestamp: new Date().toISOString(),
  };
}
