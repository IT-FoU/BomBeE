export type NetworkStatus = {
  online: boolean;
  stale: boolean;
};

export function readNetworkStatus(nowOnline = typeof navigator !== 'undefined' ? navigator.onLine : true): NetworkStatus {
  return { online: nowOnline, stale: !nowOnline };
}

export function assertOnlineForMutation(online: boolean, action: string): void {
  if (!online) throw new Error(`offline_blocks_${action}`);
}

/** Pages that must not be cached by the service worker. */
export const SENSITIVE_ROUTES = ['account', 'checkout', 'payment', 'otp'] as const;

export function isSensitiveRoute(route: string): boolean {
  return (SENSITIVE_ROUTES as readonly string[]).includes(route);
}
