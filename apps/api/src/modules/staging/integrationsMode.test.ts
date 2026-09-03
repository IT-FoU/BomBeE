import { describe, expect, it } from 'vitest';

import {
  assertIntegrationsModeAllowed,
  defaultIntegrationsMode,
} from './integrationsMode.js';

describe('integrationsMode', () => {
  it('defaults to mock/sandbox until Owner live credentials', () => {
    expect(defaultIntegrationsMode('local')).toBe('mock');
    expect(defaultIntegrationsMode('staging')).toBe('sandbox');
    expect(defaultIntegrationsMode('production')).toBe('sandbox');
  });

  it('blocks live mode without Owner approval', () => {
    expect(() =>
      assertIntegrationsModeAllowed({
        appEnv: 'staging',
        integrationsMode: 'live',
        ownerLiveCredentialsApproved: false,
      }),
    ).toThrow(/Live integrations are blocked/);
  });

  it('blocks live mode on local even with approval flag misuse', () => {
    expect(() =>
      assertIntegrationsModeAllowed({
        appEnv: 'local',
        integrationsMode: 'live',
        ownerLiveCredentialsApproved: true,
      }),
    ).toThrow(/Local environment must use mock/);
  });
});
