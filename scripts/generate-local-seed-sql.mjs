#!/usr/bin/env node
/**
 * Generate SQL seed from tests/fixtures/staging-qa-catalog.json for local Postgres.
 * Synthetic only — never Production data.
 *
 *   node scripts/generate-local-seed-sql.mjs
 *   # writes supabase/seed/generated_staging_qa.sql
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'tests/fixtures/staging-qa-catalog.json');
const outPath = path.join(root, 'supabase/seed/generated_staging_qa.sql');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const lines = [];
lines.push('-- AUTO-GENERATED from tests/fixtures/staging-qa-catalog.json');
lines.push('-- Synthetic QA seed only. Do not apply to Production.');
lines.push('-- Requires migrations through 20260903170000_staging_beta_invites.sql');
lines.push('');
lines.push('BEGIN;');
lines.push('');

for (const invite of catalog.invites ?? []) {
  const code = String(invite.inviteCode).replace(/'/g, "''");
  const role = String(invite.intendedRole ?? 'customer').replace(/'/g, "''");
  const maxUses = Number(invite.maxUses ?? 1);
  lines.push(
    `INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)`,
  );
  lines.push(
    `VALUES ('${code}', '${role}', ${maxUses}, 'generated from staging-qa-catalog')`,
  );
  lines.push(`ON CONFLICT (invite_code) DO NOTHING;`);
  lines.push('');
}

lines.push('-- Catalog/store product rows need auth + store domain IDs;');
lines.push('-- keep product JSON fixture for PWA/API tests until hosted Staging exists.');
lines.push(
  `SELECT 'seed_invites' AS kind, count(*)::int AS n FROM app.beta_invites WHERE note LIKE 'generated from staging-qa-catalog%';`,
);
lines.push('');
lines.push('COMMIT;');
lines.push('');

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inviteCount: (catalog.invites ?? []).length,
      productCount: catalog.productCount ?? catalog.products?.length ?? 0,
    },
    null,
    2,
  ),
);
