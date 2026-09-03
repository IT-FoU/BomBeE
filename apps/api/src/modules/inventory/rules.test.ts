import { describe, expect, it } from 'vitest';

import {
  availableQty,
  canAllocateLot,
  qrReservationExpiresAt,
  QR_RESERVATION_GRACE_MS,
  nextVerificationDue,
  VERIFICATION_INTERVAL_MS,
} from './rules.js';

describe('inventory rules', () => {
  it('computes available and QR expiry grace', () => {
    expect(availableQty(10, 3, 2)).toBe(5);
    expect(qrReservationExpiresAt(1_000)).toBe(1_000 + QR_RESERVATION_GRACE_MS);
    expect(nextVerificationDue(0)).toBe(VERIFICATION_INTERVAL_MS);
  });

  it('blocks expired blocked and recall lots', () => {
    expect(
      canAllocateLot({
        status: 'available',
        expiryDate: '2026-09-10',
        minRemainingDays: 90,
        now: Date.parse('2026-09-03T00:00:00.000Z'),
      }).ok,
    ).toBe(false);
    expect(canAllocateLot({ status: 'recall', minRemainingDays: 90 })).toEqual({
      ok: false,
      reason: 'lot_recall',
    });
  });
});
