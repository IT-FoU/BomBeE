export type IntegrationsMode = 'mock' | 'sandbox' | 'live';

/** Phase 1: live integrations require written Owner credentials + Production order. */
export function assertIntegrationsModeAllowed(input: {
  appEnv: 'local' | 'staging' | 'production';
  integrationsMode: IntegrationsMode;
  ownerLiveCredentialsApproved: boolean;
}): void {
  if (input.integrationsMode === 'live' && !input.ownerLiveCredentialsApproved) {
    throw new Error(
      'Live integrations are blocked until Owner provides credentials and written approval',
    );
  }
  if (input.appEnv === 'local' && input.integrationsMode === 'live') {
    throw new Error('Local environment must use mock integrations only');
  }
}

export function defaultIntegrationsMode(
  appEnv: 'local' | 'staging' | 'production',
): IntegrationsMode {
  if (appEnv === 'local') return 'mock';
  if (appEnv === 'staging') return 'sandbox';
  return 'sandbox';
}
