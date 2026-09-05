import type { PGlite } from '@electric-sql/pglite';

import { availableQty, qrReservationExpiresAt } from './rules.js';
import type { InventoryService } from './inventoryService.js';

export class ReservationService {
  constructor(
    private readonly db: PGlite,
    private readonly inventory: InventoryService,
  ) {}

  async reserve(input: {
    balanceId: string;
    quantity: number;
    reservationType: 'qr' | 'cod';
    idempotencyKey: string;
    correlationId: string;
    paymentDeadlineAt?: number;
    now?: number;
    lotAllocatable?: boolean;
  }) {
    if (input.quantity <= 0) throw new Error('quantity_must_be_positive');
    if (input.lotAllocatable === false) {
      return { ok: false as const, reason: 'lot_not_allocatable' };
    }

    const existing = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM private.inventory_reservations WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return {
        ok: true as const,
        reservationId: existing.rows[0].id,
        idempotentReplay: true as const,
        status: existing.rows[0].status,
      };
    }

    const now = input.now ?? Date.now();
    let expiresAt: string | null = null;
    let paymentDeadline: string | null = null;
    if (input.reservationType === 'qr') {
      if (!input.paymentDeadlineAt) throw new Error('payment_deadline_required');
      paymentDeadline = new Date(input.paymentDeadlineAt).toISOString();
      expiresAt = new Date(qrReservationExpiresAt(input.paymentDeadlineAt)).toISOString();
    }

    await this.db.query(`BEGIN`);
    try {
      const bal = await this.inventory._lockBalance(input.balanceId);
      const available = availableQty(bal.on_hand, bal.reserved, bal.safety_buffer);
      if (available < input.quantity) {
        await this.inventory._alertStockout({
          storeId: bal.store_id,
          variantId: bal.variant_id,
          requestedQty: input.quantity,
          availableQty: available,
          correlationId: input.correlationId,
        });
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'insufficient_available' };
      }

      const reserved = bal.reserved + input.quantity;
      await this.db.query(
        `UPDATE private.inventory_balances
         SET reserved = $2, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [input.balanceId, reserved],
      );
      await this.inventory._appendTx({
        balanceId: input.balanceId,
        txType: 'reserve',
        quantity: input.quantity,
        correlationId: input.correlationId,
        reason: `${input.reservationType}_reserve`,
      });

      const row = await this.db.query<{ id: string }>(
        `INSERT INTO private.inventory_reservations
          (balance_id, quantity, reservation_type, status, payment_deadline_at,
           expires_at, idempotency_key, correlation_id)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7)
         RETURNING id`,
        [
          input.balanceId,
          input.quantity,
          input.reservationType,
          paymentDeadline,
          expiresAt,
          input.idempotencyKey,
          input.correlationId,
        ],
      );
      await this.db.query(`COMMIT`);
      return {
        ok: true as const,
        reservationId: row.rows[0]!.id,
        idempotentReplay: false as const,
        status: 'active',
        now,
      };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      // unique idempotency race
      const again = await this.db.query<{ id: string; status: string }>(
        `SELECT id, status FROM private.inventory_reservations WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (again.rows[0]) {
        return {
          ok: true as const,
          reservationId: again.rows[0].id,
          idempotentReplay: true as const,
          status: again.rows[0].status,
        };
      }
      throw error;
    }
  }

  async release(input: {
    reservationId: string;
    correlationId: string;
    reason?: string;
    finalStatus?: 'released' | 'expired';
  }) {
    await this.db.query(`BEGIN`);
    try {
      const res = await this.db.query<{
        id: string;
        balance_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, balance_id, quantity, status
         FROM private.inventory_reservations WHERE id = $1 FOR UPDATE`,
        [input.reservationId],
      );
      const current = res.rows[0];
      if (!current) {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'not_found' };
      }
      if (current.status !== 'active') {
        await this.db.query(`COMMIT`);
        return { ok: true as const, idempotentReplay: true as const, status: current.status };
      }

      const bal = await this.inventory._lockBalance(current.balance_id);
      const reserved = Math.max(0, bal.reserved - current.quantity);
      await this.db.query(
        `UPDATE private.inventory_balances
         SET reserved = $2, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [current.balance_id, reserved],
      );
      await this.inventory._appendTx({
        balanceId: current.balance_id,
        txType: 'release',
        quantity: -current.quantity,
        correlationId: input.correlationId,
        reason: input.reason ?? 'release',
      });
      const finalStatus = input.finalStatus ?? 'released';
      await this.db.query(
        `UPDATE private.inventory_reservations
         SET status = $2, released_at = timezone('utc', now())
         WHERE id = $1`,
        [current.id, finalStatus],
      );
      await this.db.query(`COMMIT`);
      return { ok: true as const, idempotentReplay: false as const, status: finalStatus };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  /** Ship/handoff: drop reserved + on_hand via allocate, mark reservation consumed. */
  async consume(input: {
    reservationId: string;
    correlationId: string;
    reason?: string;
  }) {
    await this.db.query(`BEGIN`);
    try {
      const res = await this.db.query<{
        id: string;
        balance_id: string;
        quantity: number;
        status: string;
      }>(
        `SELECT id, balance_id, quantity, status
         FROM private.inventory_reservations WHERE id = $1 FOR UPDATE`,
        [input.reservationId],
      );
      const current = res.rows[0];
      if (!current) {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'not_found' };
      }
      if (current.status === 'consumed') {
        await this.db.query(`COMMIT`);
        return { ok: true as const, idempotentReplay: true as const, status: 'consumed' as const };
      }
      if (current.status !== 'active') {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: `not_active:${current.status}` };
      }

      const bal = await this.inventory._lockBalance(current.balance_id);
      if (bal.on_hand < current.quantity || bal.reserved < current.quantity) {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'insufficient_for_consume' };
      }
      await this.db.query(
        `UPDATE private.inventory_balances
         SET on_hand = $2, reserved = $3, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [
          current.balance_id,
          bal.on_hand - current.quantity,
          bal.reserved - current.quantity,
        ],
      );
      await this.inventory._appendTx({
        balanceId: current.balance_id,
        txType: 'allocate',
        quantity: -current.quantity,
        correlationId: input.correlationId,
        reason: input.reason ?? 'ship_consume',
      });
      await this.db.query(
        `UPDATE private.inventory_reservations
         SET status = 'consumed', released_at = timezone('utc', now())
         WHERE id = $1`,
        [current.id],
      );
      await this.db.query(`COMMIT`);
      return {
        ok: true as const,
        idempotentReplay: false as const,
        status: 'consumed' as const,
        quantity: current.quantity,
        balanceId: current.balance_id,
      };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  async expireDue(now = Date.now()) {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM private.inventory_reservations
       WHERE status = 'active' AND reservation_type = 'qr'
         AND expires_at IS NOT NULL AND expires_at <= to_timestamp($1 / 1000.0)`,
      [now],
    );
    const results = [];
    for (const row of due.rows) {
      const released = await this.release({
        reservationId: row.id,
        correlationId: crypto.randomUUID(),
        reason: 'qr_expired',
        finalStatus: 'expired',
      });
      results.push({ reservationId: row.id, ...released });
    }
    return results;
  }

  async listReservations(limit = 50, status?: string) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      balance_id: string;
      quantity: number;
      reservation_type: string;
      status: string;
      payment_deadline_at: string | null;
      expires_at: string | null;
      idempotency_key: string;
      correlation_id: string;
      created_at: string;
      released_at: string | null;
      variant_id: string | null;
      store_id: string | null;
    }>(
      status
        ? `SELECT r.id, r.balance_id, r.quantity, r.reservation_type, r.status,
                  r.payment_deadline_at::text, r.expires_at::text, r.idempotency_key,
                  r.correlation_id::text, r.created_at::text, r.released_at::text,
                  b.variant_id, b.store_id
           FROM private.inventory_reservations r
           LEFT JOIN private.inventory_balances b ON b.id = r.balance_id
           WHERE r.status = $2
           ORDER BY r.created_at DESC
           LIMIT $1`
        : `SELECT r.id, r.balance_id, r.quantity, r.reservation_type, r.status,
                  r.payment_deadline_at::text, r.expires_at::text, r.idempotency_key,
                  r.correlation_id::text, r.created_at::text, r.released_at::text,
                  b.variant_id, b.store_id
           FROM private.inventory_reservations r
           LEFT JOIN private.inventory_balances b ON b.id = r.balance_id
           ORDER BY r.created_at DESC
           LIMIT $1`,
      status ? [capped, status] : [capped],
    );
    return rows.rows.map((r) => ({
      reservationId: r.id,
      balanceId: r.balance_id,
      quantity: r.quantity,
      reservationType: r.reservation_type,
      status: r.status,
      paymentDeadlineAt: r.payment_deadline_at,
      expiresAt: r.expires_at,
      idempotencyKey: r.idempotency_key,
      correlationId: r.correlation_id,
      createdAt: r.created_at,
      releasedAt: r.released_at,
      variantId: r.variant_id,
      storeId: r.store_id,
    }));
  }
}
