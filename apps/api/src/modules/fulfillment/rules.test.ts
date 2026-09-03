import { describe, expect, it } from 'vitest';

import {
  assertReturnEligible,
  addBusinessDays,
  isLatePacking,
  isWithinDisputeWindow,
  packingDueAt,
  refundSlaDueAt,
  settlementEligible,
} from './rules.js';

describe('fulfillment rules', () => {
  it('enforces packing SLA and return window/reasons', () => {
    const confirmed = new Date('2026-09-03T08:00:00.000Z');
    expect(packingDueAt(confirmed).toISOString()).toBe('2026-09-04T08:00:00.000Z');
    expect(isLatePacking(confirmed, null, new Date('2026-09-04T09:00:00.000Z'))).toBe(true);
    expect(
      assertReturnEligible({
        reason: 'change_of_mind',
        deliveredAt: confirmed,
        requestedAt: confirmed,
      }).ok,
    ).toBe(false);
    expect(
      assertReturnEligible({
        reason: 'defective',
        deliveredAt: confirmed,
        requestedAt: new Date('2026-09-12T08:00:00.000Z'),
      }).ok,
    ).toBe(false);
    const ok = assertReturnEligible({
      reason: 'wrong_item',
      deliveredAt: confirmed,
      requestedAt: new Date('2026-09-05T08:00:00.000Z'),
    });
    expect(ok).toEqual({ ok: true, shippingLiability: 'store' });
  });

  it('computes refund SLA and settlement eligibility', () => {
    // Fri Sep 4 2026 + 7 business days => Tue Sep 15
    const due = refundSlaDueAt(new Date('2026-09-04T10:00:00.000Z'));
    expect(due.toISOString().slice(0, 10)).toBe('2026-09-15');
    // next business day after Friday is Monday
    expect(addBusinessDays(new Date('2026-09-04T00:00:00.000Z'), 1).getUTCDay()).toBe(1);
    expect(
      settlementEligible({
        childStatus: 'delivered',
        paymentReceived: true,
        returnHold: false,
      }),
    ).toBe(true);
    expect(
      settlementEligible({
        childStatus: 'delivered',
        paymentReceived: true,
        returnHold: true,
      }),
    ).toBe(false);
    expect(
      isWithinDisputeWindow(
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-08T00:00:00.000Z'),
      ),
    ).toBe(true);
  });
});
