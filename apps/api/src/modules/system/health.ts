import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME } from '@bombee/shared';

export type HealthResponse = {
  status: 'ok';
  service: string;
  env: BombeeEnv['APP_ENV'];
  egoPosEnabled: boolean;
  inviteOnlyEnabled: boolean;
  integrationsMode: BombeeEnv['INTEGRATIONS_MODE'];
  productionDeployAuthorized: boolean;
  productionHold: boolean;
  timestamp: string;
};

export function getHealth(env: BombeeEnv): HealthResponse {
  const productionDeployAuthorized = env.OWNER_PRODUCTION_DEPLOY_APPROVED;
  return {
    status: 'ok',
    service: BRAND_NAME,
    env: env.APP_ENV,
    egoPosEnabled: env.EGO_POS_ENABLED,
    inviteOnlyEnabled: env.INVITE_ONLY_ENABLED,
    integrationsMode: env.INTEGRATIONS_MODE,
    productionDeployAuthorized,
    /** Hold lifts only after written Owner Production deploy approval flag is set. */
    productionHold: !productionDeployAuthorized,
    timestamp: new Date().toISOString(),
  };
}
