/** Integer LAK (kip). Never use floating point for money. */
export type LakAmount = number & { readonly __brand: 'LakAmount' };

export const CURRENCY_CODE = 'LAK' as const;
export const DISPLAY_TIMEZONE = 'Asia/Vientiane' as const;
export const BRAND_NAME = 'BomBee Market' as const;

export function LAK(amount: number): LakAmount {
  if (!Number.isInteger(amount)) {
    throw new Error('LAK amounts must be integers (kip)');
  }
  return amount as LakAmount;
}

export function assertNonNegativeLak(amount: LakAmount): void {
  if (amount < 0) {
    throw new Error('LAK amount cannot be negative');
  }
}

export function addLak(a: LakAmount, b: LakAmount): LakAmount {
  return LAK(a + b);
}

export function subtractLak(a: LakAmount, b: LakAmount): LakAmount {
  return LAK(a - b);
}

export function formatLak(amount: LakAmount, locale: 'lo-LA' | 'en-US' = 'en-US'): string {
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount);
  return `${formatted} ${CURRENCY_CODE}`;
}
