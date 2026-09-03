import { describe, expect, it } from 'vitest';

import { shouldSuspendForCounts, QUALITY_THRESHOLDS } from './qualityService.js';
import { resolveContractForOrderTime } from './contractService.js';
import { canActivateStore, isOnboardingComplete } from './storeService.js';

describe('store domain unit rules', () => {
  it('requires full onboarding checklist', () => {
    expect(
      isOnboardingComplete({
        ownerIdOk: true,
        storeInfoOk: true,
        bankAccountOk: true,
        contractOk: false,
      }),
    ).toBe(false);
    expect(
      canActivateStore({
        checklist: {
          ownerIdOk: true,
          storeInfoOk: true,
          bankAccountOk: true,
          contractOk: true,
        },
        hasActiveFulfillment: true,
        hasExpiredRequiredDocs: true,
      }),
    ).toEqual({ ok: false, reason: 'documents_expired' });
  });

  it('uses quality thresholds from requirements', () => {
    expect(QUALITY_THRESHOLDS.slow_response_or_pack).toBe(5);
    expect(shouldSuspendForCounts({ stock_mismatch: 3 })).toBe('stock_mismatch');
    expect(shouldSuspendForCounts({ wrong_damaged_mismatch: 2 })).toBeNull();
  });

  it('picks effective contract without rewriting older orders', () => {
    const versions = [
      {
        id: 'a',
        revenueModel: 'commission' as const,
        commissionBps: 1000,
        settlementCadence: 'weekly' as const,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'b',
        revenueModel: 'markup' as const,
        markupBps: 500,
        settlementCadence: 'daily' as const,
        effectiveFrom: '2026-06-01T00:00:00.000Z',
      },
    ];
    expect(resolveContractForOrderTime(versions, '2026-02-01T00:00:00.000Z')?.id).toBe('a');
    expect(resolveContractForOrderTime(versions, '2026-08-01T00:00:00.000Z')?.id).toBe('b');
  });
});
