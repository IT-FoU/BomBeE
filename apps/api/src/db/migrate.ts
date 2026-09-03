import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrationsDir(): string {
  return path.resolve(here, '../../../../supabase/migrations');
}

export function listMigrationFiles(dir = migrationsDir()): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

export async function applyMigrations(db: PGlite, dir = migrationsDir()): Promise<string[]> {
  const files = listMigrationFiles(dir);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    );
  `);

  const applied: string[] = [];
  for (const file of files) {
    const id = path.basename(file);
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM public.schema_migrations WHERE id = $1',
      [id],
    );
    if (existing.rows.length > 0) continue;
    const sql = readFileSync(file, 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO public.schema_migrations (id) VALUES ($1)', [id]);
    applied.push(id);
  }
  return applied;
}

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await applyMigrations(db);
  return db;
}
