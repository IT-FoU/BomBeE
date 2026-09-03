import { createServer } from 'node:http';

import { loadEnv } from '@bombee/config';
import { BRAND_NAME } from '@bombee/shared';

import { createAppRouter } from './app.js';

const env = loadEnv();
const router = createAppRouter(env);

const server = createServer((req, res) => {
  void router(req, res);
});

server.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console -- intentional boot log
  console.log(`${BRAND_NAME} API listening on :${env.API_PORT} (${env.APP_ENV})`);
});
