import { describe, expect, it } from 'vitest';

import { BRAND_NAME } from '@bombee/shared';

import { PRODUCTS } from './data/catalog.js';
import { BACKOFFICE_NAV_CHECK } from './pwaMeta.js';

describe('customer PWA shell', () => {
  it('keeps BomBee brand and catalog fixtures for discovery', () => {
    expect(BRAND_NAME).toBe('BomBee Market');
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(4);
    expect(PRODUCTS.some((p) => p.deal)).toBe(true);
    expect(BACKOFFICE_NAV_CHECK).toContain('manifest');
  });
});
