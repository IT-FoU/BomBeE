import { describe, expect, it } from 'vitest';

import { APP_ROLES, formatLak, LAK, t } from '@bombee/shared';

import { BACKOFFICE_NAV_IDS } from './App.js';

describe('backoffice shell QA', () => {
  it('lists seven standard roles and full nav surface ids', () => {
    expect(APP_ROLES).toHaveLength(7);
    expect(BACKOFFICE_NAV_IDS).toEqual(
      expect.arrayContaining([
        'dashboard',
        'stores',
        'catalog',
        'inventory',
        'orders',
        'payments',
        'fulfillment',
        'settlements',
        'promotions',
        'support',
        'integrations',
        'notifications',
        'approvals',
        'staff',
        'audit',
        'exports',
      ]),
    );
  });

  it('formats LAK without decimals for Lo/En overflow checks', () => {
    expect(formatLak(LAK(1_250_000), 'en-US')).toBe('1,250,000 LAK');
    expect(formatLak(LAK(1_250_000), 'lo-LA')).toContain('LAK');
    expect(t('noProductionData', 'en')).toMatch(/No production customer data/i);
  });
});
