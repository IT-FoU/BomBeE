import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const base = {
  APP_ENV: 'local',
  PUBLIC_API_URL: 'http://localhost:8787',
  PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
  PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
  EGO_POS_ENABLED: 'false',
} as const;

describe('parseEnv', () => {
  it('accepts a valid local configuration', () => {
    const env = parseEnv({ ...base });
    expect(env.APP_ENV).toBe('local');
    expect(env.CURRENCY_CODE).toBe('LAK');
    expect(env.DISPLAY_TIMEZONE).toBe('Asia/Vientiane');
    expect(env.EGO_POS_ENABLED).toBe(false);
  });

  it('fails fast when required URLs are missing', () => {
    expect(() => parseEnv({ APP_ENV: 'local' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects EGO POS enabled in any environment', () => {
    expect(() =>
      parseEnv({
        ...base,
        EGO_POS_ENABLED: 'true',
      }),
    ).toThrow(/EGO POS must remain disabled/);
  });

  it('rejects local env pointing at production-like hosts', () => {
    expect(() =>
      parseEnv({
        ...base,
        SUPABASE_URL: 'https://prod-bombee.supabase.co',
      }),
    ).toThrow(/must not point at Production/);
  });

  it('defaults invite-only off on local and integrations to mock', () => {
    const env = parseEnv({ ...base });
    expect(env.INVITE_ONLY_ENABLED).toBe(false);
    expect(env.INTEGRATIONS_MODE).toBe('mock');
  });

  it('defaults invite-only on for staging with sandbox integrations', () => {
    const env = parseEnv({
      ...base,
      APP_ENV: 'staging',
      NODE_ENV: 'production',
    });
    expect(env.INVITE_ONLY_ENABLED).toBe(true);
    expect(env.INTEGRATIONS_MODE).toBe('sandbox');
  });

  it('rejects live integrations until Owner approval path is opened', () => {
    expect(() =>
      parseEnv({
        ...base,
        INTEGRATIONS_MODE: 'live',
      }),
    ).toThrow(/Live integrations require written Owner/);
  });
});
