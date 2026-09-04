#!/usr/bin/env node
/**
 * Fail if customer production JS gzip exceeds ADR 0004 budget (250 KB).
 * Run after `pnpm --filter @bombee/customer build`.
 */
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'apps/customer/dist/assets');
const BUDGET_JS_GZIP = 250 * 1024;

if (!existsSync(assetsDir)) {
  console.error('Missing apps/customer/dist/assets — run customer build first');
  process.exit(2);
}

const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
let totalGzip = 0;
for (const file of jsFiles) {
  const buf = readFileSync(path.join(assetsDir, file));
  const gz = gzipSync(buf).byteLength;
  totalGzip += gz;
  console.log(`${file}: ${gz} bytes gzip`);
}

console.log(`total_js_gzip=${totalGzip} budget=${BUDGET_JS_GZIP}`);
if (totalGzip > BUDGET_JS_GZIP) {
  console.error('FAIL: customer JS gzip exceeds 250KB budget (ADR 0004)');
  process.exit(1);
}
console.log('OK: customer bundle within budget');
