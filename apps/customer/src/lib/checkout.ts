export const COD_NEW_LIMIT_LAK = 500_000;
export const COD_DEPOSIT_THRESHOLD_LAK = 300_000;
export const COD_DEPOSIT_PERCENT = 30;

export function evaluateCodUx(input: {
  amountLak: number;
  isNewCustomer: boolean;
  phoneVerified: boolean;
  failCount: number;
}): { allowed: boolean; reason?: string; depositLak: number } {
  if (input.failCount >= 2) return { allowed: false, reason: 'qr_forced', depositLak: 0 };
  if (input.isNewCustomer && input.amountLak > COD_NEW_LIMIT_LAK) {
    return { allowed: false, reason: 'new_customer_limit', depositLak: 0 };
  }
  let depositLak = 0;
  if (input.amountLak >= COD_DEPOSIT_THRESHOLD_LAK) {
    if (!input.phoneVerified) return { allowed: false, reason: 'phone_verification_required', depositLak: 0 };
    depositLak = Math.floor((input.amountLak * COD_DEPOSIT_PERCENT) / 100);
  }
  return { allowed: true, depositLak };
}

export type OrderView = {
  parentId: string;
  status: string;
  children: Array<{ id: string; storeName: string; status: string; totalLak: number }>;
};

export function parentChildSummary(order: OrderView) {
  return {
    combinedTotalLak: order.children.reduce((s, c) => s + c.totalLak, 0),
    byStore: order.children.map((c) => ({
      storeName: c.storeName,
      status: c.status,
      totalLak: c.totalLak,
    })),
  };
}
