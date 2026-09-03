import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { createTestDatabase } from './migrate.js';
import type { PGlite } from '@electric-sql/pglite';

describe('migrations', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies all milestone 1 migrations', async () => {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM public.schema_migrations ORDER BY id`,
    );
    expect(rows.rows.map((r) => r.id)).toEqual([
      '20260903080000_extensions_and_schemas.sql',
      '20260903080100_identity_and_sessions.sql',
      '20260903080200_roles_and_permissions.sql',
      '20260903080300_audit_and_exports.sql',
      '20260903080400_rls_policies.sql',
      '20260903090000_store_domain.sql',
      '20260903090100_contracts_and_payouts.sql',
      '20260903090200_store_quality_controls.sql',
      '20260903100000_catalog_products.sql',
      '20260903100100_catalog_media_pricing.sql',
      '20260903110000_inventory_ledger.sql',
      '20260903110100_inventory_reservations_lots.sql',
      '20260903120000_orders_parent_child.sql',
      '20260903130000_payment_ledger.sql',
      '20260903140000_delivery_returns_settlement.sql',
    ]);
  });

  it('stores money as bigint LAK example', async () => {
    await db.query(`INSERT INTO private.money_unit_example (amount_lak) VALUES (500000)`);
    const row = await db.query<{ amount_lak: number }>(
      `SELECT amount_lak FROM private.money_unit_example LIMIT 1`,
    );
    expect(row.rows[0]?.amount_lak).toBe(500000);
  });

  it('uses UTC timestamps', async () => {
    const row = await db.query<{ v: string }>(`SELECT app.current_utc()::text AS v`);
    expect(row.rows[0]?.v).toMatch(/Z|[+-]\d{2}/);
  });
});
