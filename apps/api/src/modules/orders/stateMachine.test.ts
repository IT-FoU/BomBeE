import { describe, expect, it } from 'vitest';

import {
  canTransition,
  deriveParentStatus,
  isBeforeCourierHandoff,
  recalculatePromoDiscount,
} from './stateMachine.js';

describe('order state machine', () => {
  it('allows only defined transitions', () => {
    expect(canTransition('packing', 'ready')).toBe(true);
    expect(canTransition('packing', 'delivered')).toBe(false);
    expect(canTransition('cancelled', 'packing')).toBe(false);
  });

  it('derives parent completed with cancellation note for mixed outcomes', () => {
    expect(deriveParentStatus(['delivered', 'cancelled'])).toEqual({
      status: 'completed',
      cancellationNote: 'Some store orders were cancelled; remaining deliveries completed.',
    });
  });

  it('recalculates promo after partial cancel and detects handoff boundary', () => {
    expect(
      recalculatePromoDiscount({
        subtotalLak: 10000,
        percentOff: 10,
        cancelledLineTotalLak: 2000,
      }),
    ).toEqual({ discountLak: 800, newSubtotalLak: 8000, newTotalLak: 7200 });
    expect(isBeforeCourierHandoff('ready')).toBe(true);
    expect(isBeforeCourierHandoff('handed_to_courier')).toBe(false);
  });
});
