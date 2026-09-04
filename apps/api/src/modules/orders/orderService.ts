import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import {
  canTransition,
  deriveParentStatus,
  isBeforeCourierHandoff,
  recalculatePromoDiscount,
  type ChildStatus,
} from './stateMachine.js';

export type CartLine = {
  storeId: string;
  variantId: string;
  quantity: number;
};

export class OrderService {
  constructor(
    private readonly db: PGlite,
    private readonly audit = new AuditService(db),
  ) {}

  async createCart(customerIdentityId: string) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.carts (customer_identity_id) VALUES ($1) RETURNING id`,
      [customerIdentityId],
    );
    return row.rows[0]!.id;
  }

  async addCartItem(cartId: string, line: CartLine) {
    await this.db.query(
      `INSERT INTO app.cart_items (cart_id, store_id, variant_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (cart_id, variant_id)
       DO UPDATE SET quantity = EXCLUDED.quantity`,
      [cartId, line.storeId, line.variantId, line.quantity],
    );
  }

  async checkout(input: {
    cartId: string;
    customerIdentityId: string;
    actorIdentityId: string;
    shippingLakByStore?: Record<string, number>;
    promoPercentOff?: number;
    correlationId: string;
  }) {
    await this.db.query(`BEGIN`);
    try {
      const items = await this.db.query<{
        store_id: string;
        variant_id: string;
        quantity: number;
        status: string;
        sku: string;
        title_lo: string;
        title_en: string;
        can_accept_orders: boolean;
        selling_price_lak: number | null;
      }>(
        `SELECT ci.store_id, ci.variant_id, ci.quantity,
                pv.status, pv.sku,
                coalesce(pt_lo.title, '') AS title_lo,
                coalesce(pt_en.title, '') AS title_en,
                s.can_accept_orders,
                pr.selling_price_lak
         FROM app.cart_items ci
         JOIN app.product_variants pv ON pv.id = ci.variant_id
         JOIN app.products p ON p.id = pv.product_id
         JOIN app.stores s ON s.id = ci.store_id
         LEFT JOIN app.product_translations pt_lo
           ON pt_lo.product_id = p.id AND pt_lo.locale = 'lo'
         LEFT JOIN app.product_translations pt_en
           ON pt_en.product_id = p.id AND pt_en.locale = 'en'
         LEFT JOIN finance.price_versions pr
           ON pr.variant_id = pv.id AND pr.status = 'approved'
         WHERE ci.cart_id = $1`,
        [input.cartId],
      );

      if (items.rows.length === 0) {
        await this.db.query(`ROLLBACK`);
        throw new Error('cart_empty');
      }

      for (const item of items.rows) {
        if (item.status !== 'active') throw new Error('variant_not_active');
        if (!item.can_accept_orders) throw new Error('store_not_accepting_orders');
        if (item.selling_price_lak === null) throw new Error('price_not_approved');
      }

      const orderNumber = `P-${Date.now()}`;
      const parent = await this.db.query<{ id: string }>(
        `INSERT INTO app.parent_orders
          (order_number, customer_identity_id, status, subtotal_lak, discount_lak, shipping_lak, total_lak)
         VALUES ($1,$2,'pending_supplier',0,0,0,0) RETURNING id`,
        [orderNumber, input.customerIdentityId],
      );
      const parentId = parent.rows[0]!.id;

      const byStore = new Map<string, typeof items.rows>();
      for (const item of items.rows) {
        const list = byStore.get(item.store_id) ?? [];
        list.push(item);
        byStore.set(item.store_id, list);
      }

      let parentSubtotal = 0;
      let parentShipping = 0;
      const childIds: string[] = [];

      let storeIndex = 1;
      for (const [storeId, storeItems] of byStore) {
        let subtotal = 0;
        for (const item of storeItems) {
          subtotal += item.selling_price_lak! * item.quantity;
        }
        const shipping = input.shippingLakByStore?.[storeId] ?? 0;
        const discount = Math.floor((subtotal * (input.promoPercentOff ?? 0)) / 100);
        const total = subtotal - discount + shipping;
        parentSubtotal += subtotal;
        parentShipping += shipping;

        const childNumber = `${orderNumber}-S${storeIndex}`;
        storeIndex += 1;
        const child = await this.db.query<{ id: string }>(
          `INSERT INTO app.child_orders
            (parent_order_id, store_id, child_order_number, status,
             subtotal_lak, discount_lak, shipping_lak, total_lak)
           VALUES ($1,$2,$3,'pending_supplier',$4,$5,$6,$7)
           RETURNING id`,
          [parentId, storeId, childNumber, subtotal, discount, shipping, total],
        );
        const childId = child.rows[0]!.id;
        childIds.push(childId);

        for (const item of storeItems) {
          const lineTotal = item.selling_price_lak! * item.quantity;
          await this.db.query(
            `INSERT INTO app.order_items
              (child_order_id, variant_id, store_id, sku, title_lo, title_en,
               unit_price_lak, quantity, line_total_lak, promo_snapshot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [
              childId,
              item.variant_id,
              storeId,
              item.sku,
              item.title_lo,
              item.title_en,
              item.selling_price_lak,
              item.quantity,
              lineTotal,
              JSON.stringify({ percentOff: input.promoPercentOff ?? 0 }),
            ],
          );
        }

        await this.db.query(
          `INSERT INTO app.order_documents (child_order_id, doc_type, payload)
           VALUES ($1,'store_summary',$2::jsonb)`,
          [
            childId,
            JSON.stringify({
              childOrderNumber: childNumber,
              storeId,
              subtotal,
              discount,
              shipping,
              total,
            }),
          ],
        );
      }

      const parentDiscount = Math.floor((parentSubtotal * (input.promoPercentOff ?? 0)) / 100);
      const parentTotal = parentSubtotal - parentDiscount + parentShipping;
      await this.db.query(
        `UPDATE app.parent_orders
         SET subtotal_lak = $2, discount_lak = $3, shipping_lak = $4, total_lak = $5
         WHERE id = $1`,
        [parentId, parentSubtotal, parentDiscount, parentShipping, parentTotal],
      );
      await this.db.query(
        `INSERT INTO app.order_documents (parent_order_id, doc_type, payload)
         VALUES ($1,'combined_summary',$2::jsonb)`,
        [
          parentId,
          JSON.stringify({
            orderNumber,
            subtotal: parentSubtotal,
            discount: parentDiscount,
            shipping: parentShipping,
            total: parentTotal,
            stores: childIds.length,
          }),
        ],
      );
      await this.db.query(`UPDATE app.carts SET status = 'converted' WHERE id = $1`, [input.cartId]);
      await this.db.query(`COMMIT`);

      await this.audit.append({
        actorIdentityId: input.actorIdentityId,
        actorType: 'customer',
        action: 'order.created',
        targetType: 'parent_order',
        targetId: parentId,
        correlationId: input.correlationId,
        afterState: { orderNumber, childIds },
      });

      return { parentId, orderNumber, childIds };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  async transitionChild(input: {
    childOrderId: string;
    toStatus: ChildStatus;
    actorIdentityId: string;
    reason: string;
    correlationId: string;
  }) {
    await this.db.query(`BEGIN`);
    try {
      const row = await this.db.query<{
        id: string;
        status: ChildStatus;
        parent_order_id: string;
      }>(
        `SELECT id, status, parent_order_id FROM app.child_orders WHERE id = $1 FOR UPDATE`,
        [input.childOrderId],
      );
      const current = row.rows[0];
      if (!current) {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'not_found' };
      }
      if (!canTransition(current.status, input.toStatus)) {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'transition_forbidden' };
      }

      try {
        await this.db.query(
          `INSERT INTO app.order_status_transitions
            (child_order_id, from_status, to_status, actor_identity_id, reason, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            current.id,
            current.status,
            input.toStatus,
            input.actorIdentityId,
            input.reason,
            input.correlationId,
          ],
        );
      } catch {
        await this.db.query(`ROLLBACK`);
        return { ok: false as const, reason: 'replayed_transition' };
      }

      await this.db.query(
        `UPDATE app.child_orders SET status = $2, updated_at = timezone('utc', now()) WHERE id = $1`,
        [current.id, input.toStatus],
      );

      const siblings = await this.db.query<{ status: ChildStatus }>(
        `SELECT status FROM app.child_orders WHERE parent_order_id = $1`,
        [current.parent_order_id],
      );
      const derived = deriveParentStatus(siblings.rows.map((s) => s.status));
      await this.db.query(
        `UPDATE app.parent_orders
         SET status = $2, cancellation_note = $3, updated_at = timezone('utc', now())
         WHERE id = $1`,
        [current.parent_order_id, derived.status, derived.cancellationNote ?? null],
      );
      await this.db.query(`COMMIT`);

      await this.audit.append({
        actorIdentityId: input.actorIdentityId,
        actorType: 'staff',
        action: 'order.transition',
        targetType: 'child_order',
        targetId: current.id,
        reason: input.reason,
        correlationId: input.correlationId,
        beforeState: { status: current.status },
        afterState: { status: input.toStatus },
      });

      return { ok: true as const, from: current.status, to: input.toStatus, parent: derived };
    } catch (error) {
      await this.db.query(`ROLLBACK`);
      throw error;
    }
  }

  async previewCancellation(input: {
    parentOrderId: string;
    scope: 'item' | 'store' | 'order';
    childOrderId?: string;
    orderItemId?: string;
    promoPercentOff?: number;
  }) {
    const parent = await this.db.query<{
      id: string;
      subtotal_lak: number;
      discount_lak: number;
      total_lak: number;
    }>(
      `SELECT id, subtotal_lak, discount_lak, total_lak FROM app.parent_orders WHERE id = $1`,
      [input.parentOrderId],
    );
    const p = parent.rows[0];
    if (!p) throw new Error('parent_not_found');

    let cancelledLineTotal = 0;
    if (input.scope === 'item' && input.orderItemId) {
      const item = await this.db.query<{ line_total_lak: number }>(
        `SELECT line_total_lak FROM app.order_items WHERE id = $1`,
        [input.orderItemId],
      );
      cancelledLineTotal = item.rows[0]?.line_total_lak ?? 0;
    } else if (input.scope === 'store' && input.childOrderId) {
      const child = await this.db.query<{ subtotal_lak: number }>(
        `SELECT subtotal_lak FROM app.child_orders WHERE id = $1`,
        [input.childOrderId],
      );
      cancelledLineTotal = child.rows[0]?.subtotal_lak ?? 0;
    } else if (input.scope === 'order') {
      cancelledLineTotal = p.subtotal_lak;
    }

    const recalculated = recalculatePromoDiscount({
      subtotalLak: p.subtotal_lak,
      percentOff: input.promoPercentOff,
      cancelledLineTotalLak: cancelledLineTotal,
    });

    const preview = await this.db.query<{ id: string }>(
      `INSERT INTO app.cancellation_previews
        (parent_order_id, scope, payload)
       VALUES ($1,$2,$3::jsonb) RETURNING id`,
      [
        input.parentOrderId,
        input.scope,
        JSON.stringify({
          cancelledLineTotal,
          before: { subtotal: p.subtotal_lak, discount: p.discount_lak, total: p.total_lak },
          after: recalculated,
        }),
      ],
    );
    return { previewId: preview.rows[0]!.id, ...recalculated, cancelledLineTotal };
  }

  async confirmCancellation(input: {
    parentOrderId: string;
    previewId: string;
    scope: 'item' | 'store' | 'order';
    childOrderId?: string;
    orderItemId?: string;
    actorIdentityId: string;
    paymentReceived?: boolean;
    correlationId: string;
    promoPercentOff?: number;
  }) {
    const children = await this.db.query<{ id: string; status: ChildStatus }>(
      `SELECT id, status FROM app.child_orders WHERE parent_order_id = $1`,
      [input.parentOrderId],
    );

    for (const child of children.rows) {
      if (input.scope === 'store' && child.id !== input.childOrderId) continue;
      if (input.scope === 'item' && input.childOrderId && child.id !== input.childOrderId) continue;
      if (!isBeforeCourierHandoff(child.status)) {
        return { ok: false as const, reason: 'use_refusal_or_return_workflow' };
      }
    }

    await this.db.query(
      `UPDATE app.cancellation_previews SET confirmed = true WHERE id = $1`,
      [input.previewId],
    );

    if (input.scope === 'item' && input.orderItemId) {
      await this.db.query(`UPDATE app.order_items SET status = 'cancelled' WHERE id = $1`, [
        input.orderItemId,
      ]);
      if (input.childOrderId) {
        await this.transitionChild({
          childOrderId: input.childOrderId,
          toStatus: 'partial_cancelled',
          actorIdentityId: input.actorIdentityId,
          reason: 'item_cancelled',
          correlationId: input.correlationId,
        });
      }
    } else if (input.scope === 'store' && input.childOrderId) {
      await this.db.query(
        `UPDATE app.order_items SET status = 'cancelled' WHERE child_order_id = $1`,
        [input.childOrderId],
      );
      await this.transitionChild({
        childOrderId: input.childOrderId,
        toStatus: 'cancelled',
        actorIdentityId: input.actorIdentityId,
        reason: 'store_cancelled',
        correlationId: input.correlationId,
      });
    } else if (input.scope === 'order') {
      for (const child of children.rows) {
        await this.db.query(
          `UPDATE app.order_items SET status = 'cancelled' WHERE child_order_id = $1`,
          [child.id],
        );
        const transitioned = await this.transitionChild({
          childOrderId: child.id,
          toStatus: 'cancelled',
          actorIdentityId: input.actorIdentityId,
          reason: 'order_cancelled',
          correlationId: crypto.randomUUID(),
        });
        if (!transitioned.ok) {
          return { ok: false as const, reason: transitioned.reason };
        }
      }
    }

    if (input.paymentReceived && input.childOrderId) {
      const refund = await this.db.query<{ id: string }>(
        `INSERT INTO app.refund_requests (child_order_id, amount_lak, reason)
         VALUES ($1,
           (SELECT total_lak FROM app.child_orders WHERE id = $1),
           'cancellation after QR payment')
         RETURNING id`,
        [input.childOrderId],
      );
      return { ok: true as const, refundRequestId: refund.rows[0]!.id };
    }

    return { ok: true as const };
  }

  async requestSplitShipment(input: {
    childOrderId: string;
    makerIdentityId: string;
    reason: string;
    itemQuantities: Array<{ orderItemId: string; quantity: number }>;
  }) {
    const req = await this.db.query<{ id: string }>(
      `INSERT INTO app.split_shipment_requests
        (child_order_id, maker_identity_id, reason)
       VALUES ($1,$2,$3) RETURNING id`,
      [input.childOrderId, input.makerIdentityId, input.reason],
    );
    const shipment = await this.db.query<{ id: string }>(
      `INSERT INTO app.shipments (child_order_id, requires_admin_approval, status)
       VALUES ($1,true,'pending') RETURNING id`,
      [input.childOrderId],
    );
    for (const line of input.itemQuantities) {
      await this.db.query(
        `INSERT INTO app.shipment_items (shipment_id, order_item_id, quantity)
         VALUES ($1,$2,$3)`,
        [shipment.rows[0]!.id, line.orderItemId, line.quantity],
      );
    }
    return { requestId: req.rows[0]!.id, shipmentId: shipment.rows[0]!.id };
  }

  async approveSplitShipment(input: {
    requestId: string;
    shipmentId: string;
    approverIdentityId: string;
    actorRoles: string[];
  }) {
    if (!input.actorRoles.includes('admin') && !input.actorRoles.includes('owner')) {
      return { ok: false as const, reason: 'admin_required' };
    }
    const req = await this.db.query<{ maker_identity_id: string; status: string }>(
      `SELECT maker_identity_id, status FROM app.split_shipment_requests WHERE id = $1`,
      [input.requestId],
    );
    const current = req.rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' };
    if (current.maker_identity_id === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }
    await this.db.query(
      `UPDATE app.split_shipment_requests
       SET status = 'approved', approver_identity_id = $2, decided_at = timezone('utc', now())
       WHERE id = $1`,
      [input.requestId, input.approverIdentityId],
    );
    await this.db.query(
      `UPDATE app.shipments SET status = 'approved', approved_by = $2 WHERE id = $1`,
      [input.shipmentId, input.approverIdentityId],
    );
    return { ok: true as const };
  }

  async getOrderViews(parentOrderId: string) {
    const parent = await this.db.query(`SELECT * FROM app.parent_orders WHERE id = $1`, [
      parentOrderId,
    ]);
    const children = await this.db.query(
      `SELECT * FROM app.child_orders WHERE parent_order_id = $1 ORDER BY child_order_number`,
      [parentOrderId],
    );
    const docs = await this.db.query(
      `SELECT * FROM app.order_documents
       WHERE parent_order_id = $1
          OR child_order_id IN (SELECT id FROM app.child_orders WHERE parent_order_id = $1)`,
      [parentOrderId],
    );
    return {
      combined: parent.rows[0],
      byStore: children.rows,
      documents: docs.rows,
    };
  }
}
