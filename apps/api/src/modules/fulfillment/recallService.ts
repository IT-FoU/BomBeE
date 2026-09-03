import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';

export class RecallService {
  constructor(
    private readonly db: PGlite,
    private readonly audit = new AuditService(db),
  ) {}

  async startRecall(input: {
    productId: string;
    lotId?: string;
    reason: string;
    createdBy: string;
  }) {
    await this.db.query(`UPDATE app.products SET status = 'archived' WHERE id = $1`, [
      input.productId,
    ]);
    await this.db.query(
      `UPDATE app.product_variants SET status = 'archived', archived_at = timezone('utc', now())
       WHERE product_id = $1`,
      [input.productId],
    );
    const recall = await this.db.query<{ id: string }>(
      `INSERT INTO app.product_recalls
        (product_id, lot_id, reason, store_bears_cost, created_by)
       VALUES ($1,$2,$3,true,$4) RETURNING id`,
      [input.productId, input.lotId ?? null, input.reason, input.createdBy],
    );
    const affected = await this.db.query<{
      child_order_id: string;
      customer_identity_id: string;
    }>(
      `SELECT DISTINCT co.id AS child_order_id, po.customer_identity_id
       FROM app.order_items oi
       JOIN app.child_orders co ON co.id = oi.child_order_id
       JOIN app.parent_orders po ON po.id = co.parent_order_id
       JOIN app.product_variants pv ON pv.id = oi.variant_id
       WHERE pv.product_id = $1
         AND oi.status = 'active'
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM private.inventory_lots l
           WHERE l.id = $2 AND l.variant_id = pv.id
         ))`,
      [input.productId, input.lotId ?? null],
    );
    for (const row of affected.rows) {
      await this.db.query(
        `INSERT INTO app.recall_affected_orders
          (recall_id, child_order_id, customer_identity_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (recall_id, child_order_id) DO NOTHING`,
        [recall.rows[0]!.id, row.child_order_id, row.customer_identity_id],
      );
    }
    await this.audit.append({
      actorIdentityId: input.createdBy,
      actorType: 'staff',
      action: 'recall.started',
      targetType: 'product_recall',
      targetId: recall.rows[0]!.id,
      afterState: { productId: input.productId, affected: affected.rows.length },
      correlationId: crypto.randomUUID(),
    });
    return {
      recallId: recall.rows[0]!.id,
      affectedCount: affected.rows.length,
      storeBearsCost: true as const,
    };
  }

  async recordContact(input: {
    recallId: string;
    childOrderId: string;
    contactStatus: 'contacted' | 'unreachable';
    resolution?: 'refund' | 'replacement' | 'declined' | 'pending';
  }) {
    await this.db.query(
      `UPDATE app.recall_affected_orders
       SET contact_status = $3, resolution = coalesce($4, resolution)
       WHERE recall_id = $1 AND child_order_id = $2`,
      [
        input.recallId,
        input.childOrderId,
        input.contactStatus,
        input.resolution ?? null,
      ],
    );
  }

  async isComplete(recallId: string) {
    const open = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.recall_affected_orders
       WHERE recall_id = $1
         AND (contact_status = 'pending' OR resolution = 'pending')`,
      [recallId],
    );
    const done = (open.rows[0]?.n ?? 0) === 0;
    if (done) {
      await this.db.query(
        `UPDATE app.product_recalls
         SET status = 'completed', completed_at = timezone('utc', now())
         WHERE id = $1`,
        [recallId],
      );
    }
    return { complete: done, openCount: open.rows[0]?.n ?? 0 };
  }
}
