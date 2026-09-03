import { describe, expect, it } from 'vitest';

import {
  alertThresholds,
  canStack,
  computeDiscountLak,
  isPromotionActive,
  recalculateAfterCancel,
  wouldExceedCap,
} from './rules.js';

describe('promotion rules', () => {
  it('computes discount, stacking, caps, and alerts', () => {
    expect(computeDiscountLak(100_000, { percentOff: 10 })).toBe(10_000);
    expect(
      canStack(
        {
          allowStack: true,
          stackingGroup: 'a',
          budgetLak: 1,
          spentLak: 0,
          redeemedCount: 0,
          funding: 'platform',
          platformFundBps: 10000,
          effectiveFrom: new Date(),
          effectiveTo: new Date(),
          status: 'active',
        },
        {
          allowStack: true,
          stackingGroup: 'b',
          budgetLak: 1,
          spentLak: 0,
          redeemedCount: 0,
          funding: 'supplier',
          platformFundBps: 0,
          effectiveFrom: new Date(),
          effectiveTo: new Date(),
          status: 'active',
        },
      ),
    ).toBe(true);
    expect(
      wouldExceedCap({
        spentLak: 90,
        budgetLak: 100,
        redeemAmountLak: 20,
        redeemedCount: 0,
      }),
    ).toBe(true);
    expect(alertThresholds(0.85)).toEqual([80]);
    expect(alertThresholds(0.95)).toEqual([80, 90]);
    expect(
      recalculateAfterCancel({
        originalDiscountLak: 10_000,
        originalSubtotalLak: 100_000,
        cancelledLineTotalLak: 40_000,
        percentOff: 10,
      }),
    ).toBe(6_000);
    expect(
      isPromotionActive(
        {
          status: 'active',
          budgetLak: 100,
          spentLak: 100,
          redeemedCount: 0,
          allowStack: false,
          stackingGroup: 'default',
          funding: 'platform',
          platformFundBps: 10000,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'),
        },
        new Date('2026-06-01'),
      ),
    ).toBe(false);
  });
});
