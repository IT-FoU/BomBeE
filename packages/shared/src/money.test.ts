import { describe, expect, it } from 'vitest';

import { LAK, addLak, formatLak, subtractLak } from './money.js';

describe('LAK money helpers', () => {
  it('rejects floating point amounts', () => {
    expect(() => LAK(1.5)).toThrow(/integers/);
  });

  it('adds and subtracts as integers', () => {
    expect(addLak(LAK(1000), LAK(500))).toBe(1500);
    expect(subtractLak(LAK(1000), LAK(250))).toBe(750);
  });

  it('formats without fraction digits', () => {
    expect(formatLak(LAK(1_000_000))).toContain('LAK');
    expect(formatLak(LAK(1_000_000))).not.toMatch(/\./);
  });
});
