import { describe, expect, it } from 'vitest';

import { parseEnv } from '@bombee/config';

import { allowedOrigins, applyCors } from './cors.js';

describe('cors', () => {
  const env = parseEnv({
    APP_ENV: 'local',
    PUBLIC_API_URL: 'http://localhost:8787',
    PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
    PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
    EGO_POS_ENABLED: 'false',
  });

  it('allows configured customer and backoffice origins', () => {
    expect(allowedOrigins(env).has('http://localhost:5173')).toBe(true);
    expect(allowedOrigins(env).has('http://localhost:5174')).toBe(true);
    expect(allowedOrigins(env).has('http://evil.example')).toBe(false);
  });

  it('handles OPTIONS preflight for allowed origin', () => {
    const headers: Record<string, string> = {};
    let status = 0;
    const res = {
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      writeHead(code: number) {
        status = code;
      },
      end() {},
    };
    const out = applyCors(
      env,
      { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } } as never,
      res as never,
    );
    expect(out.handledPreflight).toBe(true);
    expect(status).toBe(204);
    expect(headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
