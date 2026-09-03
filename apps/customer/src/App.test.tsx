import { describe, expect, it } from 'vitest';

import { BRAND_NAME } from '@bombee/shared';

describe('customer shell', () => {
  it('exposes BomBee Market brand constant', () => {
    expect(BRAND_NAME).toBe('BomBee Market');
  });
});
