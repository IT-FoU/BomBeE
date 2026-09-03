import { describe, expect, it } from 'vitest';

import { formatDisplayDate, formatDisplayDateTime, t } from './i18n.js';

describe('shared i18n formatting', () => {
  it('formats dates in Asia/Vientiane for lo and en', () => {
    const iso = '2026-09-03T10:00:00.000Z';
    expect(formatDisplayDate(iso, 'en')).toMatch(/2026/);
    expect(formatDisplayDate(iso, 'lo')).toMatch(/2026/);
    expect(formatDisplayDateTime(iso, 'en')).toMatch(/2026/);
  });

  it('returns bilingual UI copy', () => {
    expect(t('backoffice', 'lo')).toContain('ຫຼັງ');
    expect(t('noProductionData', 'en')).toMatch(/No production/i);
  });
});
