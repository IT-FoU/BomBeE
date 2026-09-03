import { describe, expect, it } from 'vitest';

import { cartTotals, groupCartByStore, type CartLine } from './cart.js';
import { assertOnlineForMutation, isSensitiveRoute } from './offline.js';
import { evaluateCodUx, parentChildSummary } from './checkout.js';

describe('customer cart helpers', () => {
  const lines: CartLine[] = [
    {
      productId: 'p1',
      variantId: 'v1',
      storeId: 'store-a',
      storeName: 'A',
      title: 'Water',
      unitPriceLak: 45000,
      quantity: 2,
    },
    {
      productId: 'p2',
      variantId: 'v2',
      storeId: 'store-b',
      storeName: 'B',
      title: 'Mug',
      unitPriceLak: 89000,
      quantity: 1,
    },
  ];

  it('groups by store and totals with shipping/discount', () => {
    expect(groupCartByStore(lines)).toHaveLength(2);
    const totals = cartTotals(lines, 5000, { 'store-a': 10000, 'store-b': 12000 });
    expect(totals.subtotalLak).toBe(179000);
    expect(totals.shippingLak).toBe(22000);
    expect(totals.totalLak).toBe(196000);
  });
});

describe('offline guards', () => {
  it('blocks checkout/payment mutations offline and marks sensitive routes', () => {
    expect(() => assertOnlineForMutation(false, 'checkout')).toThrow('offline_blocks_checkout');
    expect(isSensitiveRoute('payment')).toBe(true);
    expect(isSensitiveRoute('home')).toBe(false);
  });
});

describe('COD and parent/child summary', () => {
  it('applies COD limits/deposit and summarizes parent/child', () => {
    expect(
      evaluateCodUx({
        amountLak: 600_000,
        isNewCustomer: true,
        phoneVerified: true,
        failCount: 0,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateCodUx({
        amountLak: 320_000,
        isNewCustomer: false,
        phoneVerified: true,
        failCount: 0,
      }).depositLak,
    ).toBe(96_000);
    const summary = parentChildSummary({
      parentId: 'P1',
      status: 'in_progress',
      children: [
        { id: 'c1', storeName: 'A', status: 'delivered', totalLak: 100 },
        { id: 'c2', storeName: 'B', status: 'in_transit', totalLak: 50 },
      ],
    });
    expect(summary.combinedTotalLak).toBe(150);
    expect(summary.byStore).toHaveLength(2);
  });
});
