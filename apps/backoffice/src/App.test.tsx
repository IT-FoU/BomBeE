import { describe, expect, it } from 'vitest';

import { APP_ROLES } from '@bombee/shared';

describe('backoffice shell', () => {
  it('lists the seven standard staff roles', () => {
    expect(APP_ROLES).toHaveLength(7);
    expect(APP_ROLES).toContain('owner');
    expect(APP_ROLES).toContain('auditor');
  });
});
