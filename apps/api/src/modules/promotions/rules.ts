export type PromoFunding = 'platform' | 'supplier' | 'split';

export type PromotionInput = {
  percentOff?: number;
  amountOffLak?: number;
  budgetLak: number;
  quantityCap?: number;
  spentLak: number;
  redeemedCount: number;
  allowStack: boolean;
  stackingGroup: string;
  funding: PromoFunding;
  platformFundBps: number;
  effectiveFrom: Date;
  effectiveTo: Date;
  status: string;
};

export function isPromotionActive(p: PromotionInput, now: Date): boolean {
  return (
    p.status === 'active' &&
    now >= p.effectiveFrom &&
    now <= p.effectiveTo &&
    p.spentLak < p.budgetLak &&
    (p.quantityCap === undefined || p.redeemedCount < p.quantityCap)
  );
}

export function computeDiscountLak(subtotalLak: number, p: Pick<PromotionInput, 'percentOff' | 'amountOffLak'>): number {
  if (p.percentOff != null) return Math.floor((subtotalLak * p.percentOff) / 100);
  return Math.min(subtotalLak, p.amountOffLak ?? 0);
}

export function canStack(a: PromotionInput, b: PromotionInput): boolean {
  if (!a.allowStack || !b.allowStack) return false;
  return a.stackingGroup !== b.stackingGroup;
}

export function usageRatio(p: Pick<PromotionInput, 'spentLak' | 'budgetLak' | 'redeemedCount' | 'quantityCap'>): number {
  const budgetRatio = p.budgetLak > 0 ? p.spentLak / p.budgetLak : 0;
  const qtyRatio =
    p.quantityCap && p.quantityCap > 0 ? p.redeemedCount / p.quantityCap : 0;
  return Math.max(budgetRatio, qtyRatio);
}

export function alertThresholds(ratio: number): Array<80 | 90> {
  const out: Array<80 | 90> = [];
  if (ratio >= 0.8) out.push(80);
  if (ratio >= 0.9) out.push(90);
  return out;
}

export function wouldExceedCap(input: {
  spentLak: number;
  budgetLak: number;
  redeemAmountLak: number;
  redeemedCount: number;
  quantityCap?: number;
}): boolean {
  if (input.spentLak + input.redeemAmountLak > input.budgetLak) return true;
  if (input.quantityCap != null && input.redeemedCount + 1 > input.quantityCap) return true;
  return false;
}

export function recalculateAfterCancel(input: {
  originalDiscountLak: number;
  originalSubtotalLak: number;
  cancelledLineTotalLak: number;
  percentOff?: number;
}): number {
  const newSubtotal = Math.max(0, input.originalSubtotalLak - input.cancelledLineTotalLak);
  if (input.percentOff != null) return Math.floor((newSubtotal * input.percentOff) / 100);
  return Math.min(input.originalDiscountLak, newSubtotal);
}
