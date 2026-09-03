import { describe, expect, it } from 'vitest';

import {
  assertAuthenticBrandClaim,
  assertNotProhibitedCategory,
  assertShelfLifeFields,
  isBelowCost,
  marginLak,
  validateMediaUpload,
} from './rules.js';

describe('catalog rules', () => {
  it('blocks prohibited categories and authentic claims without evidence', () => {
    expect(() => assertNotProhibitedCategory('weapons')).toThrow(/prohibited/);
    expect(() =>
      assertAuthenticBrandClaim({ claimsAuthenticBrand: true, brandVerified: false }),
    ).toThrow(/evidence/);
  });

  it('requires shelf-life fields and integer LAK margins', () => {
    expect(() =>
      assertShelfLifeFields({
        hasShelfLife: true,
        productionDate: '2026-01-01',
      }),
    ).toThrow(/shelf_life/);
    expect(marginLak(1200, 1000)).toBe(200);
    expect(isBelowCost(900, 1000)).toBe(true);
  });

  it('enforces media type/size/duration limits', () => {
    expect(
      validateMediaUpload({
        mediaType: 'video',
        mimeType: 'video/mp4',
        byteSize: 1000,
        durationSeconds: 200,
      }),
    ).toEqual({ ok: false, reason: 'duration_too_long' });
  });
});
