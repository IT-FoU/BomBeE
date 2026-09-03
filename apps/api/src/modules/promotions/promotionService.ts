import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import { NotificationBus } from '../notifications/bus.js';
import {
  alertThresholds,
  canStack,
  computeDiscountLak,
  isPromotionActive,
  recalculateAfterCancel,
  usageRatio,
  wouldExceedCap,
  type PromoFunding,
} from './rules.js';

export class PromotionService {
  constructor(
    private readonly db: PGlite,
    private readonly notifications = new NotificationBus(),
    private readonly audit = new AuditService(db),
  ) {}

  async createPromotion(input: {
    code: string;
    titleLo: string;
    titleEn: string;
    percentOff?: number;
    amountOffLak?: number;
    allowStack?: boolean;
    stackingGroup?: string;
    funding: PromoFunding;
    platformFundBps?: number;
    budgetLak: number;
    quantityCap?: number;
    effectiveFrom: Date;
    effectiveTo: Date;
  }) {
    const platformFundBps =
      input.platformFundBps ??
      (input.funding === 'platform' ? 10000 : input.funding === 'supplier' ? 0 : 5000);
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.promotions
        (code, title_lo, title_en, status, percent_off, amount_off_lak, allow_stack,
         stacking_group, funding, platform_fund_bps, budget_lak, quantity_cap,
         effective_from, effective_to)
       VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        input.code,
        input.titleLo,
        input.titleEn,
        input.percentOff ?? null,
        input.amountOffLak ?? null,
        input.allowStack ?? false,
        input.stackingGroup ?? 'default',
        input.funding,
        platformFundBps,
        input.budgetLak,
        input.quantityCap ?? null,
        input.effectiveFrom.toISOString(),
        input.effectiveTo.toISOString(),
      ],
    );
    return row.rows[0]!.id;
  }

  async applyToOrder(input: {
    promotionIds: string[];
    parentOrderId: string;
    subtotalLak: number;
    idempotencyKey: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const existing = await this.db.query<{ id: string; amount_lak: number }>(
      `SELECT id, amount_lak FROM app.promotion_redemptions WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return {
        discountLak: Number(existing.rows[0].amount_lak),
        idempotentReplay: true as const,
      };
    }

    await this.db.query(`BEGIN`);
    try {
      const promos = [];
      for (const id of input.promotionIds) {
        const row = await this.db.query<{
          id: string;
          status: string;
          percent_off: number | null;
          amount_off_lak: number | null;
          allow_stack: boolean;
          stacking_group: string;
          funding: PromoFunding;
          platform_fund_bps: number;
          budget_lak: number;
          quantity_cap: number | null;
          spent_lak: number;
          redeemed_count: number;
          effective_from: string;
          effective_to: string;
          alert_80_sent: boolean;
          alert_90_sent: boolean;
        }>(`SELECT * FROM app.promotions WHERE id = $1`, [id]);
        if (!row.rows[0]) throw new Error('promotion_not_found');
        const p = row.rows[0];
        const mapped = {
          percentOff: p.percent_off ?? undefined,
          amountOffLak: p.amount_off_lak ?? undefined,
          budgetLak: Number(p.budget_lak),
          quantityCap: p.quantity_cap ?? undefined,
          spentLak: Number(p.spent_lak),
          redeemedCount: p.redeemed_count,
          allowStack: p.allow_stack,
          stackingGroup: p.stacking_group,
          funding: p.funding,
          platformFundBps: p.platform_fund_bps,
          effectiveFrom: new Date(p.effective_from),
          effectiveTo: new Date(p.effective_to),
          status: p.status,
        };
        if (!isPromotionActive(mapped, now)) throw new Error('promotion_inactive');
        promos.push({ id: p.id, mapped, raw: p });
      }

      if (promos.length === 2 && !canStack(promos[0]!.mapped, promos[1]!.mapped)) {
        throw new Error('stacking_not_allowed');
      }
      if (promos.length > 2) throw new Error('max_two_stack');

      let discountLak = 0;
      const snapshots = [];
      for (const promo of promos) {
        const amount = computeDiscountLak(input.subtotalLak - discountLak, promo.mapped);
        if (
          wouldExceedCap({
            spentLak: promo.mapped.spentLak,
            budgetLak: promo.mapped.budgetLak,
            redeemAmountLak: amount,
            redeemedCount: promo.mapped.redeemedCount,
            quantityCap: promo.mapped.quantityCap,
          })
        ) {
          throw new Error('promotion_cap_exceeded');
        }
        discountLak += amount;
        snapshots.push({
          promotionId: promo.id,
          amountLak: amount,
          funding: promo.mapped.funding,
          platformFundBps: promo.mapped.platformFundBps,
        });
      }

      for (const snap of snapshots) {
        await this.db.query(
          `INSERT INTO app.promotion_redemptions
            (promotion_id, parent_order_id, amount_lak, idempotency_key)
           VALUES ($1,$2,$3,$4)`,
          [
            snap.promotionId,
            input.parentOrderId,
            snap.amountLak,
            `${input.idempotencyKey}:${snap.promotionId}`,
          ],
        );
        await this.db.query(
          `UPDATE app.promotions
           SET spent_lak = spent_lak + $2,
               redeemed_count = redeemed_count + 1,
               status = CASE
                 WHEN spent_lak + $2 >= budget_lak THEN 'exhausted'
                 WHEN quantity_cap IS NOT NULL AND redeemed_count + 1 >= quantity_cap THEN 'exhausted'
                 ELSE status
               END
           WHERE id = $1`,
          [snap.promotionId, snap.amountLak],
        );
        const updated = await this.db.query<{
          spent_lak: number;
          budget_lak: number;
          redeemed_count: number;
          quantity_cap: number | null;
          alert_80_sent: boolean;
          alert_90_sent: boolean;
        }>(
          `SELECT spent_lak, budget_lak, redeemed_count, quantity_cap, alert_80_sent, alert_90_sent
           FROM app.promotions WHERE id = $1`,
          [snap.promotionId],
        );
        const u = updated.rows[0]!;
        const ratio = usageRatio({
          spentLak: Number(u.spent_lak),
          budgetLak: Number(u.budget_lak),
          redeemedCount: u.redeemed_count,
          quantityCap: u.quantity_cap ?? undefined,
        });
        for (const thr of alertThresholds(ratio)) {
          const flag = thr === 80 ? u.alert_80_sent : u.alert_90_sent;
          if (flag) continue;
          await this.db.query(
            `INSERT INTO app.promotion_alerts (promotion_id, threshold_pct)
             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [snap.promotionId, thr],
          );
          await this.db.query(
            `UPDATE app.promotions SET
               alert_80_sent = CASE WHEN $2 = 80 THEN true ELSE alert_80_sent END,
               alert_90_sent = CASE WHEN $2 = 90 THEN true ELSE alert_90_sent END
             WHERE id = $1`,
            [snap.promotionId, thr],
          );
          await this.notifications.publish({
            channel: 'in_app',
            toRole: 'owner',
            template: 'promotion.budget_alert',
            payload: { promotionId: snap.promotionId, threshold: thr },
          });
        }
      }
      await this.db.query(
        `UPDATE app.parent_orders SET discount_lak = $2, total_lak = subtotal_lak + shipping_lak - $2
         WHERE id = $1`,
        [input.parentOrderId, discountLak],
      );
      await this.db.query(`COMMIT`);
      return { discountLak, snapshots, notifications: this.notifications.messages };
    } catch (e) {
      await this.db.query(`ROLLBACK`);
      throw e;
    }
  }

  recalculateOnCancel(input: {
    originalDiscountLak: number;
    originalSubtotalLak: number;
    cancelledLineTotalLak: number;
    percentOff?: number;
  }) {
    return recalculateAfterCancel(input);
  }
}
