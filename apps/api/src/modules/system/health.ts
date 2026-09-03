import type { BombeeEnv } from '@bombee/config';
import { BRAND_NAME } from '@bombee/shared';

export type HealthResponse = {
  status: 'ok';
  service: string;
  env: BombeeEnv['APP_ENV'];
  egoPosEnabled: boolean;
  timestamp: string;
};

export function getHealth(env: BombeeEnv): HealthResponse {
  return {
    status: 'ok',
    service: BRAND_NAME,
    env: env.APP_ENV,
    egoPosEnabled: env.EGO_POS_ENABLED,
    timestamp: new Date().toISOString(),
  };
}
