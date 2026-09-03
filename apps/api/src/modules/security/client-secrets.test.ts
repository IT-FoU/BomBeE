import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe('client bundle secret hygiene', () => {
  it('does not embed service-role key names as assigned secrets in UI apps', () => {
    const uiRoots = [path.join(root, 'apps/customer/src'), path.join(root, 'apps/backoffice/src')];
    const offenders: string[] = [];
    for (const uiRoot of uiRoots) {
      for (const file of collectFiles(uiRoot)) {
        if (!/\.(ts|tsx|js|jsx|css|html)$/.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        if (/SUPABASE_SERVICE_ROLE_KEY\s*=/.test(text) || /service_role_[A-Za-z0-9]{20,}/.test(text)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
