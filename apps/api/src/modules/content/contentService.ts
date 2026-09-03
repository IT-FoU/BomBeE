import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import { NotificationBus } from '../notifications/bus.js';
import {
  assertReviewEditable,
  assertVerifiedReviewWindow,
  looksSuspicious,
  validateTikTokUrl,
} from './rules.js';

export class ContentService {
  constructor(
    private readonly db: PGlite,
    private readonly notifications = new NotificationBus(),
    private readonly audit = new AuditService(db),
  ) {}

  async createReview(input: {
    productId: string;
    childOrderId: string;
    customerIdentityId: string;
    rating: number;
    bodyLo?: string;
    bodyEn?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const order = await this.db.query<{
      status: string;
      customer_identity_id: string;
      updated_at: string;
    }>(
      `SELECT co.status, po.customer_identity_id, co.updated_at::text
       FROM app.child_orders co
       JOIN app.parent_orders po ON po.id = co.parent_order_id
       WHERE co.id = $1`,
      [input.childOrderId],
    );
    const child = order.rows[0];
    if (!child) throw new Error('child_order_not_found');
    if (child.customer_identity_id !== input.customerIdentityId) {
      throw new Error('not_order_owner');
    }
    const item = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.order_items oi
       JOIN app.product_variants pv ON pv.id = oi.variant_id
       WHERE oi.child_order_id = $1 AND pv.product_id = $2 AND oi.status = 'active'`,
      [input.childOrderId, input.productId],
    );
    if ((item.rows[0]?.n ?? 0) < 1) throw new Error('not_verified_purchase');

    // Prefer delivery timestamp when present
    const delivery = await this.db.query<{ delivered_at: string | null }>(
      `SELECT delivered_at::text FROM app.shipment_deliveries
       WHERE child_order_id = $1 AND status = 'delivered'
       ORDER BY delivered_at DESC NULLS LAST LIMIT 1`,
      [input.childOrderId],
    );
    const deliveredAt = delivery.rows[0]?.delivered_at
      ? new Date(delivery.rows[0].delivered_at)
      : new Date(child.updated_at);
    assertVerifiedReviewWindow({
      childStatus: child.status,
      deliveredAt,
      now,
    });

    const body = `${input.bodyLo ?? ''} ${input.bodyEn ?? ''}`;
    const status = looksSuspicious(body) ? 'hidden' : 'published';
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.product_reviews
        (product_id, child_order_id, customer_identity_id, rating, body_lo, body_en,
         verified_purchase, status, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8) RETURNING id`,
      [
        input.productId,
        input.childOrderId,
        input.customerIdentityId,
        input.rating,
        input.bodyLo ?? null,
        input.bodyEn ?? null,
        status,
        deliveredAt.toISOString(),
      ],
    );
    await this.db.query(
      `INSERT INTO app.product_review_versions
        (review_id, version_no, rating, body_lo, body_en)
       VALUES ($1,1,$2,$3,$4)`,
      [row.rows[0]!.id, input.rating, input.bodyLo ?? null, input.bodyEn ?? null],
    );
    if (status === 'hidden') {
      await this.notifications.publish({
        channel: 'in_app',
        toRole: 'owner',
        template: 'content.suspicious_review',
        payload: { reviewId: row.rows[0]!.id },
      });
    }
    return { reviewId: row.rows[0]!.id, status, verifiedPurchase: true as const };
  }

  async editReview(input: {
    reviewId: string;
    customerIdentityId: string;
    rating: number;
    bodyLo?: string;
    bodyEn?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const row = await this.db.query<{
      customer_identity_id: string;
      created_at: string;
      version_no: number;
    }>(
      `SELECT r.customer_identity_id, r.created_at::text,
              coalesce((SELECT max(version_no) FROM app.product_review_versions v WHERE v.review_id = r.id),0) AS version_no
       FROM app.product_reviews r WHERE r.id = $1`,
      [input.reviewId],
    );
    if (!row.rows[0]) throw new Error('review_not_found');
    if (row.rows[0].customer_identity_id !== input.customerIdentityId) {
      throw new Error('not_review_owner');
    }
    assertReviewEditable(new Date(row.rows[0].created_at), now);
    const next = row.rows[0].version_no + 1;
    await this.db.query(
      `UPDATE app.product_reviews
       SET rating = $2, body_lo = $3, body_en = $4, updated_at = timezone('utc', now())
       WHERE id = $1`,
      [input.reviewId, input.rating, input.bodyLo ?? null, input.bodyEn ?? null],
    );
    await this.db.query(
      `INSERT INTO app.product_review_versions
        (review_id, version_no, rating, body_lo, body_en)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.reviewId, next, input.rating, input.bodyLo ?? null, input.bodyEn ?? null],
    );
    return { versionNo: next };
  }

  async submitSupplierResponse(input: {
    reviewId: string;
    storeId: string;
    body: string;
  }) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.product_review_responses (review_id, store_id, body, status)
       VALUES ($1,$2,$3,'pending') RETURNING id`,
      [input.reviewId, input.storeId, input.body],
    );
    return { responseId: row.rows[0]!.id, status: 'pending' as const };
  }

  async approveSupplierResponse(input: {
    responseId: string;
    approverIdentityId: string;
  }) {
    await this.db.query(
      `UPDATE app.product_review_responses
       SET status = 'approved', approved_at = timezone('utc', now()), approved_by = $2
       WHERE id = $1`,
      [input.responseId, input.approverIdentityId],
    );
  }

  async submitTikTokLink(input: {
    url: string;
    productId?: string;
    submittedByType: 'staff' | 'supplier' | 'customer';
    submittedBy?: string;
  }) {
    const check = validateTikTokUrl(input.url);
    if (!check.ok) throw new Error(check.reason);
    const suspicious = looksSuspicious(check.url);
    let status: 'pending' | 'published' | 'hidden_suspicious' =
      input.submittedByType === 'staff' ? 'published' : 'pending';
    if (suspicious) status = 'hidden_suspicious';
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.tiktok_links
        (url, product_id, submitted_by_type, submitted_by, status, published_at, moderation_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        check.url,
        input.productId ?? null,
        input.submittedByType,
        input.submittedBy ?? null,
        status,
        status === 'published' ? new Date().toISOString() : null,
        suspicious ? 'auto_hidden_suspicious' : null,
      ],
    );
    if (status === 'hidden_suspicious') {
      await this.notifications.publish({
        channel: 'in_app',
        toRole: 'owner',
        template: 'content.suspicious_tiktok',
        payload: { linkId: row.rows[0]!.id },
      });
    }
    return { linkId: row.rows[0]!.id, status };
  }

  async moderateTikTok(input: {
    linkId: string;
    approve: boolean;
    actorIdentityId: string;
  }) {
    await this.db.query(
      `UPDATE app.tiktok_links
       SET status = $2, published_at = CASE WHEN $2 = 'published' THEN timezone('utc', now()) ELSE published_at END
       WHERE id = $1`,
      [input.linkId, input.approve ? 'published' : 'rejected'],
    );
    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: input.approve ? 'tiktok.published' : 'tiktok.rejected',
      targetType: 'tiktok_link',
      targetId: input.linkId,
      correlationId: crypto.randomUUID(),
    });
  }
}
