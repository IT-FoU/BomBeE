import type { PGlite } from '@electric-sql/pglite';

import {
  availableQty,
  canAllocateLot,
  DEFAULT_MIN_REMAINING_DAYS,
  nextVerificationDue,
  remainingShelfDays,
} from './rules.js';

export class InventoryService {
  constructor(private readonly db: PGlite) {}

  async setSafetyBuffer(storeId: string, variantId: string, safetyBuffer: number) {
    await this.db.query(
      `INSERT INTO private.inventory_safety_buffers (store_id, variant_id, safety_buffer)
       VALUES ($1,$2,$3)
       ON CONFLICT (store_id, variant_id)
       DO UPDATE SET safety_buffer = EXCLUDED.safety_buffer`,
      [storeId, variantId, safetyBuffer],
    );
  }

  async createLot(input: {
    storeId: string;
    variantId: string;
    locationId: string;
    lotCode: string;
    productionDate?: string;
    expiryDate?: string;
    categorySlug?: string;
  }) {
    if (input.categorySlug === 'food' || input.categorySlug === 'cosmetics') {
      if (!input.lotCode || !input.productionDate || !input.expiryDate) {
        throw new Error('lot_fields_required');
      }
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO private.inventory_lots
        (store_id, variant_id, location_id, lot_code, production_date, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.storeId,
        input.variantId,
        input.locationId,
        input.lotCode,
        input.productionDate ?? null,
        input.expiryDate ?? null,
      ],
    );
    return row.rows[0]!.id;
  }

  async ensureBalance(input: {
    storeId: string;
    locationId: string;
    variantId: string;
    lotId: string;
  }) {
    const buffer = await this.db.query<{ safety_buffer: number }>(
      `SELECT safety_buffer FROM private.inventory_safety_buffers
       WHERE store_id = $1 AND variant_id = $2`,
      [input.storeId, input.variantId],
    );
    const safety = buffer.rows[0]?.safety_buffer ?? 0;
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM private.inventory_balances
       WHERE store_id = $1 AND location_id = $2 AND variant_id = $3 AND lot_id = $4`,
      [input.storeId, input.locationId, input.variantId, input.lotId],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const created = await this.db.query<{ id: string }>(
      `INSERT INTO private.inventory_balances
        (store_id, location_id, variant_id, lot_id, safety_buffer)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.storeId, input.locationId, input.variantId, input.lotId, safety],
    );
    await this.db.query(
      `INSERT INTO private.inventory_verification_schedule
        (store_id, variant_id, due_at)
       VALUES ($1,$2, to_timestamp($3 / 1000.0))
       ON CONFLICT (store_id, variant_id) DO NOTHING`,
      [input.storeId, input.variantId, nextVerificationDue()],
    );
    return created.rows[0]!.id;
  }

  async receive(input: {
    balanceId: string;
    quantity: number;
    actorIdentityId?: string;
    correlationId: string;
    reason?: string;
  }) {
    if (input.quantity <= 0) throw new Error('quantity_must_be_positive');
    await this.db.query(`BEGIN`);
    try {
      const bal = await this.lockBalance(input.balanceId);
      const onHand = bal.on_hand + input.quantity;
      await this.db.query(
        `UPDATE private.inventory_balances
         SET on_hand = $2, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [input.balanceId, onHand],
      );
      await this.appendTx({
        balanceId: input.balanceId,
        txType: 'receive',
        quantity: input.quantity,
        correlationId: input.correlationId,
        actorIdentityId: input.actorIdentityId,
        reason: input.reason,
      });
      await this.db.query(`COMMIT`);
      return this.getBalance(input.balanceId);
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  async adjust(input: {
    balanceId: string;
    delta: number;
    reason: string;
    makerIdentityId: string;
    approverIdentityId: string;
    actorRoles: string[];
    correlationId: string;
  }) {
    if (input.makerIdentityId === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }
    if (!input.actorRoles.includes('owner') && !input.actorRoles.includes('operations')) {
      return { ok: false as const, reason: 'not_authorized' };
    }
    if (input.reason.trim().length < 8) return { ok: false as const, reason: 'reason_required' };

    await this.db.query(
      `INSERT INTO private.inventory_adjustment_requests
        (balance_id, delta, reason, status, maker_identity_id, approver_identity_id, decided_at)
       VALUES ($1,$2,$3,'approved',$4,$5, timezone('utc', now()))`,
      [
        input.balanceId,
        input.delta,
        input.reason,
        input.makerIdentityId,
        input.approverIdentityId,
      ],
    );

    await this.db.query(`BEGIN`);
    try {
      const bal = await this.lockBalance(input.balanceId);
      const onHand = bal.on_hand + input.delta;
      if (onHand < 0 || bal.reserved > onHand) {
        await this.db.query(`ROLLBACK`);
        await this.alertStockout({
          storeId: bal.store_id,
          variantId: bal.variant_id,
          requestedQty: Math.abs(input.delta),
          availableQty: availableQty(bal.on_hand, bal.reserved, bal.safety_buffer),
          correlationId: input.correlationId,
        });
        return { ok: false as const, reason: 'insufficient_stock' };
      }
      await this.db.query(
        `UPDATE private.inventory_balances
         SET on_hand = $2, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [input.balanceId, onHand],
      );
      await this.appendTx({
        balanceId: input.balanceId,
        txType: 'adjust',
        quantity: input.delta,
        correlationId: input.correlationId,
        actorIdentityId: input.approverIdentityId,
        reason: input.reason,
      });
      await this.db.query(`COMMIT`);
      return { ok: true as const, balance: await this.getBalance(input.balanceId) };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  async evaluateLotForAllocation(lotId: string, categorySlug: string, now = Date.now()) {
    const lot = await this.db.query<{
      status: string;
      expiry_date: string | null;
    }>(`SELECT status, expiry_date::text FROM private.inventory_lots WHERE id = $1`, [lotId]);
    const row = lot.rows[0];
    if (!row) return { ok: false as const, reason: 'lot_not_found' };

    const policy = await this.db.query<{ min_remaining_days: number }>(
      `SELECT min_remaining_days FROM private.category_shelf_life_policies WHERE category_slug = $1`,
      [categorySlug],
    );
    const minRemaining = policy.rows[0]?.min_remaining_days ?? DEFAULT_MIN_REMAINING_DAYS;
    const decision = canAllocateLot({
      status: row.status,
      expiryDate: row.expiry_date,
      minRemainingDays: minRemaining,
      now,
    });

    if (!decision.ok && row.expiry_date) {
      const remaining = remainingShelfDays(row.expiry_date, now);
      await this.db.query(
        `INSERT INTO private.lot_expiry_alerts (lot_id, alert_type, remaining_days)
         VALUES ($1,$2,$3)`,
        [lotId, remaining < 0 ? 'expired' : 'near_minimum', remaining],
      );
    }
    return decision;
  }

  async linkExpiryDiscount(lotId: string, discountRequestId: string) {
    await this.db.query(
      `UPDATE private.lot_expiry_alerts
       SET discount_request_id = $2
       WHERE id = (
         SELECT id FROM private.lot_expiry_alerts
         WHERE lot_id = $1 ORDER BY created_at DESC LIMIT 1
       )`,
      [lotId, discountRequestId],
    );
  }

  async previewStockImport(input: {
    storeId: string;
    idempotencyKey: string;
    rows: Array<{ variantId: string; lotId: string; onHand: number }>;
  }) {
    const existing = await this.db.query<{ id: string; preview_report: unknown }>(
      `SELECT id, preview_report FROM private.inventory_import_batches
       WHERE store_id = $1 AND idempotency_key = $2`,
      [input.storeId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { batchId: existing.rows[0].id, report: existing.rows[0].preview_report, replay: true };
    }

    const diffs = [];
    for (const row of input.rows) {
      const bal = await this.db.query<{ on_hand: number }>(
        `SELECT on_hand FROM private.inventory_balances
         WHERE store_id = $1 AND variant_id = $2 AND lot_id = $3`,
        [input.storeId, row.variantId, row.lotId],
      );
      const current = bal.rows[0]?.on_hand ?? 0;
      diffs.push({
        variantId: row.variantId,
        lotId: row.lotId,
        current,
        imported: row.onHand,
        delta: row.onHand - current,
      });
    }
    const report = { rows: diffs, differenceTotal: diffs.reduce((s, d) => s + d.delta, 0) };
    const batch = await this.db.query<{ id: string }>(
      `INSERT INTO private.inventory_import_batches
        (store_id, idempotency_key, status, preview_report)
       VALUES ($1,$2,'preview',$3::jsonb) RETURNING id`,
      [input.storeId, input.idempotencyKey, JSON.stringify(report)],
    );
    return { batchId: batch.rows[0]!.id, report, replay: false };
  }

  async reconcileLedger(balanceId: string) {
    const bal = await this.getBalance(balanceId);
    const txs = await this.db.query<{ tx_type: string; quantity: number }>(
      `SELECT tx_type, quantity FROM private.inventory_transactions WHERE balance_id = $1`,
      [balanceId],
    );
    let onHand = 0;
    let reserved = 0;
    for (const tx of txs.rows) {
      if (tx.tx_type === 'receive' || tx.tx_type === 'import') onHand += tx.quantity;
      if (tx.tx_type === 'adjust') onHand += tx.quantity;
      if (tx.tx_type === 'reserve') reserved += tx.quantity;
      if (tx.tx_type === 'release') reserved -= Math.abs(tx.quantity);
      if (tx.tx_type === 'allocate') {
        reserved -= Math.abs(tx.quantity);
        onHand -= Math.abs(tx.quantity);
      }
      if (tx.tx_type === 'expire' || tx.tx_type === 'recall') onHand -= Math.abs(tx.quantity);
    }
    return {
      balanceOnHand: bal.on_hand,
      balanceReserved: bal.reserved,
      ledgerOnHand: onHand,
      ledgerReserved: reserved,
      difference: bal.on_hand - onHand + (bal.reserved - reserved),
    };
  }

  async getBalance(balanceId: string) {
    const row = await this.db.query<{
      id: string;
      store_id: string;
      variant_id: string;
      lot_id: string;
      on_hand: number;
      reserved: number;
      safety_buffer: number;
    }>(
      `SELECT id, store_id, variant_id, lot_id, on_hand, reserved, safety_buffer
       FROM private.inventory_balances WHERE id = $1`,
      [balanceId],
    );
    const bal = row.rows[0]!;
    return {
      ...bal,
      available: availableQty(bal.on_hand, bal.reserved, bal.safety_buffer),
    };
  }

  private async lockBalance(balanceId: string) {
    const row = await this.db.query<{
      id: string;
      store_id: string;
      variant_id: string;
      on_hand: number;
      reserved: number;
      safety_buffer: number;
    }>(
      `SELECT id, store_id, variant_id, on_hand, reserved, safety_buffer
       FROM private.inventory_balances WHERE id = $1 FOR UPDATE`,
      [balanceId],
    );
    const bal = row.rows[0];
    if (!bal) throw new Error('balance_not_found');
    return bal;
  }

  private async appendTx(input: {
    balanceId: string;
    txType: string;
    quantity: number;
    correlationId: string;
    actorIdentityId?: string;
    reason?: string;
  }) {
    await this.db.query(
      `INSERT INTO private.inventory_transactions
        (balance_id, tx_type, quantity, reason, correlation_id, actor_identity_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.balanceId,
        input.txType,
        input.quantity,
        input.reason ?? null,
        input.correlationId,
        input.actorIdentityId ?? null,
      ],
    );
  }

  private async alertStockout(input: {
    storeId: string;
    variantId: string;
    requestedQty: number;
    availableQty: number;
    correlationId: string;
  }) {
    await this.db.query(
      `INSERT INTO private.inventory_stockout_alerts
        (store_id, variant_id, requested_qty, available_qty, correlation_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.storeId,
        input.variantId,
        input.requestedQty,
        input.availableQty,
        input.correlationId,
      ],
    );
  }

  /** Exposed for reservation service */
  async _lockBalance(balanceId: string) {
    return this.lockBalance(balanceId);
  }

  async _appendTx(input: {
    balanceId: string;
    txType: string;
    quantity: number;
    correlationId: string;
    actorIdentityId?: string;
    reason?: string;
  }) {
    return this.appendTx(input);
  }

  async _alertStockout(input: {
    storeId: string;
    variantId: string;
    requestedQty: number;
    availableQty: number;
    correlationId: string;
  }) {
    return this.alertStockout(input);
  }
}
