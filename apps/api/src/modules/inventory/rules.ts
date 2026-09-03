export const QR_RESERVATION_GRACE_MS = 30 * 60_000;
export const VERIFICATION_INTERVAL_MS = 3 * 24 * 60 * 60_000;
export const DEFAULT_MIN_REMAINING_DAYS = 90;

export function availableQty(onHand: number, reserved: number, safetyBuffer: number): number {
  return onHand - reserved - safetyBuffer;
}

export function assertNonNegativeStock(onHand: number, reserved: number): void {
  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    throw new Error('negative_or_inconsistent_stock');
  }
}

export function qrReservationExpiresAt(paymentDeadlineAt: number): number {
  return paymentDeadlineAt + QR_RESERVATION_GRACE_MS;
}

export function nextVerificationDue(from = Date.now()): number {
  return from + VERIFICATION_INTERVAL_MS;
}

export function remainingShelfDays(expiryDate: string, now = Date.now()): number {
  const expiry = Date.parse(`${expiryDate}T00:00:00.000Z`);
  return Math.floor((expiry - now) / (24 * 60 * 60_000));
}

export function canAllocateLot(input: {
  status: string;
  expiryDate?: string | null;
  minRemainingDays: number;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.status === 'blocked' || input.status === 'recall' || input.status === 'expired') {
    return { ok: false, reason: `lot_${input.status}` };
  }
  if (input.expiryDate) {
    const remaining = remainingShelfDays(input.expiryDate, input.now ?? Date.now());
    if (remaining < 0) return { ok: false, reason: 'lot_expired' };
    if (remaining < input.minRemainingDays) {
      return { ok: false, reason: 'below_min_shelf_life' };
    }
  }
  return { ok: true };
}
