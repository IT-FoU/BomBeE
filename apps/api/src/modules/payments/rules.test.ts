import { describe, expect, it } from 'vitest';

import {
  COD_DEPOSIT_THRESHOLD_LAK,
  COD_NEW_CUSTOMER_LIMIT_LAK,
  computeQrDeadline,
  evaluateCodEligibility,
  allocationSum,
} from './rules.js';

describe('payment rules', () => {
  it('computes same-day QR deadline with minimum 2 hours', () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const deadline = computeQrDeadline(now);
    expect(deadline.toISOString()).toBe('2026-09-03T10:00:00.000Z');
  });

  it('evaluates COD limits and deposits', () => {
    expect(
      evaluateCodEligibility({
        amountLak: COD_NEW_CUSTOMER_LIMIT_LAK,
        isNewCustomer: true,
        failedCodCount: 0,
        qrForced: false,
        phoneVerified: true,
      }).ok,
    ).toBe(true);
    expect(
      evaluateCodEligibility({
        amountLak: COD_DEPOSIT_THRESHOLD_LAK,
        isNewCustomer: false,
        failedCodCount: 0,
        qrForced: false,
        phoneVerified: true,
      }),
    ).toEqual({ ok: true, depositLak: 90_000 });
    expect(allocationSum([{ amountLak: 100 }, { amountLak: 50 }])).toBe(150);
  });
});
