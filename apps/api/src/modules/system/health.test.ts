import { describe, expect, it } from 'vitest';

import { parseEnv } from '@bombee/config';

import { getHealth } from './health.js';

describe('getHealth', () => {
  it('reports ok and keeps EGO POS disabled', () => {
    const env = parseEnv({
      APP_ENV: 'local',
      PUBLIC_API_URL: 'http://localhost:8787',
      PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
      PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
      EGO_POS_ENABLED: 'false',
    });

    const health = getHealth(env);
    expect(health.status).toBe('ok');
    expect(health.egoPosEnabled).toBe(false);
    expect(health.env).toBe('local');
    expect(health.inviteOnlyEnabled).toBe(false);
    expect(health.integrationsMode).toBe('mock');
    expect(health.productionDeployAuthorized).toBe(false);
    expect(health.productionHold).toBe(true);
  });

  it('lifts productionHold after Owner deploy approval flag', () => {
    const env = parseEnv({
      APP_ENV: 'local',
      PUBLIC_API_URL: 'http://localhost:8787',
      PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
      PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
      EGO_POS_ENABLED: 'false',
      OWNER_PRODUCTION_DEPLOY_APPROVED: 'true',
    });
    const health = getHealth(env);
    expect(health.productionDeployAuthorized).toBe(true);
    expect(health.productionHold).toBe(false);
  });
});
