export const COD_NEW_CUSTOMER_LIMIT_LAK = 500_000;
export const COD_DEPOSIT_THRESHOLD_LAK = 300_000;
export const COD_DEPOSIT_PERCENT = 30;
export const COD_FAIL_FORCE_QR = 2;
export const MIN_QR_HOURS = 2;

export type PaymentConfirmChannel = 'manual' | 'bank_api';

export function computeQrDeadline(now: Date): Date {
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );
  const minDeadline = new Date(now.getTime() + MIN_QR_HOURS * 60 * 60_000);
  return minDeadline <= endOfDay ? minDeadline : endOfDay;
}

export function assertQrDeadlineValid(expiresAt: Date, now: Date): void {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms < MIN_QR_HOURS * 60 * 60_000 - 1000) {
    // allow exact min; reject if under 2h unless end-of-day capped
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );
    if (expiresAt.getTime() !== endOfDay.getTime()) {
      throw new Error('qr_deadline_must_be_at_least_2_hours');
    }
  }
  if (expiresAt.getUTCDate() !== now.getUTCDate() || expiresAt.getUTCMonth() !== now.getUTCMonth()) {
    throw new Error('qr_deadline_must_be_same_day');
  }
}

export function evaluateCodEligibility(input: {
  amountLak: number;
  isNewCustomer: boolean;
  failedCodCount: number;
  qrForced: boolean;
  phoneVerified: boolean;
}): { ok: true; depositLak: number } | { ok: false; reason: string } {
  if (input.qrForced || input.failedCodCount >= COD_FAIL_FORCE_QR) {
    return { ok: false, reason: 'qr_forced' };
  }
  if (input.isNewCustomer && input.amountLak > COD_NEW_CUSTOMER_LIMIT_LAK) {
    return { ok: false, reason: 'new_customer_limit' };
  }
  let depositLak = 0;
  if (input.amountLak >= COD_DEPOSIT_THRESHOLD_LAK) {
    if (!input.phoneVerified) return { ok: false, reason: 'phone_verification_required' };
    depositLak = Math.floor((input.amountLak * COD_DEPOSIT_PERCENT) / 100);
  }
  return { ok: true, depositLak };
}

export function allocationSum(
  allocations: Array<{ amountLak: number }>,
): number {
  return allocations.reduce((sum, a) => sum + a.amountLak, 0);
}
