import { describe, expect, it } from 'vitest';

import { validateTikTokUrl, looksSuspicious, assertReviewEditable } from './rules.js';

describe('content rules', () => {
  it('validates tiktok URLs and edit window', () => {
    expect(validateTikTokUrl('https://www.tiktok.com/@x/video/1')).toMatchObject({ ok: true });
    expect(validateTikTokUrl('http://www.tiktok.com/@x').ok).toBe(false);
    expect(validateTikTokUrl('https://evil.com/tiktok').ok).toBe(false);
    expect(looksSuspicious('click here for free money')).toBe(true);
    expect(() =>
      assertReviewEditable(new Date('2026-01-01'), new Date('2026-01-20')),
    ).toThrow('review_edit_window_exceeded');
  });
});
