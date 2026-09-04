import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BombeeEnv } from '@bombee/config';

export function allowedOrigins(env: BombeeEnv): Set<string> {
  return new Set([env.PUBLIC_CUSTOMER_URL, env.PUBLIC_BACKOFFICE_URL].map((u) => u.replace(/\/$/, '')));
}

export function applyCors(
  env: BombeeEnv,
  req: IncomingMessage,
  res: ServerResponse,
): { handledPreflight: boolean } {
  const origin = req.headers.origin;
  if (origin && allowedOrigins(env).has(origin.replace(/\/$/, ''))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-max-age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return { handledPreflight: true };
  }
  return { handledPreflight: false };
}
