export const PACKING_SLA_HOURS = 24;
export const RETURN_WINDOW_DAYS = 7;
export const REFUND_SLA_BUSINESS_DAYS = 7;
export const SETTLEMENT_DISPUTE_DAYS = 7;

export const ALLOWED_RETURN_REASONS = [
  'defective',
  'wrong_item',
  'incomplete',
  'materially_not_described',
] as const;

export type ReturnReason =
  | (typeof ALLOWED_RETURN_REASONS)[number]
  | 'change_of_mind';

export type ShippingLiability = 'store' | 'courier' | 'customer' | 'admin_decision';

export function packingDueAt(confirmedAt: Date): Date {
  return new Date(confirmedAt.getTime() + PACKING_SLA_HOURS * 60 * 60_000);
}

export function isLatePacking(confirmedAt: Date, packedAt: Date | null, now: Date): boolean {
  if (packedAt && packedAt.getTime() <= packingDueAt(confirmedAt).getTime()) return false;
  return now.getTime() > packingDueAt(confirmedAt).getTime();
}

export function assertReturnEligible(input: {
  reason: ReturnReason;
  deliveredAt: Date;
  requestedAt: Date;
}): { ok: true; shippingLiability: ShippingLiability } | { ok: false; reason: string } {
  if (input.reason === 'change_of_mind') {
    return { ok: false, reason: 'change_of_mind_not_allowed' };
  }
  if (!(ALLOWED_RETURN_REASONS as readonly string[]).includes(input.reason)) {
    return { ok: false, reason: 'invalid_return_reason' };
  }
  const windowMs = RETURN_WINDOW_DAYS * 24 * 60 * 60_000;
  if (input.requestedAt.getTime() - input.deliveredAt.getTime() > windowMs) {
    return { ok: false, reason: 'return_window_exceeded' };
  }
  return { ok: true, shippingLiability: liabilityForReason(input.reason) };
}

export function liabilityForReason(
  reason: Exclude<ReturnReason, 'change_of_mind'>,
): ShippingLiability {
  switch (reason) {
    case 'defective':
    case 'wrong_item':
    case 'incomplete':
    case 'materially_not_described':
      return 'store';
    default:
      return 'admin_decision';
  }
}

/** Add N business days (Mon–Fri UTC). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

export function refundSlaDueAt(approvedAt: Date): Date {
  return addBusinessDays(approvedAt, REFUND_SLA_BUSINESS_DAYS);
}

export function isWithinDisputeWindow(batchCreatedAt: Date, now: Date): boolean {
  return now.getTime() - batchCreatedAt.getTime() <= SETTLEMENT_DISPUTE_DAYS * 24 * 60 * 60_000;
}

export function settlementEligible(input: {
  childStatus: string;
  paymentReceived: boolean;
  returnHold: boolean;
}): boolean {
  return input.childStatus === 'delivered' && input.paymentReceived && !input.returnHold;
}
