import { DISPLAY_TIMEZONE } from './money.js';

export type UiLocale = 'lo' | 'en';

export function formatDisplayDate(
  iso: string | Date,
  locale: UiLocale = 'en',
): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale === 'lo' ? 'lo-LA' : 'en-US', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDisplayDateTime(
  iso: string | Date,
  locale: UiLocale = 'en',
): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale === 'lo' ? 'lo-LA' : 'en-US', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const UI_COPY = {
  backoffice: { lo: 'ຫຼັງບ້ານ', en: 'Backoffice' },
  operationsShell: { lo: 'ໜ້າຈັດການດຳເນີນງານ', en: 'Operations shell' },
  sessionIdle: {
    lo: 'ກຳນົດເວລາ idle: 1 ຊົ່ວໂມງ · ອຸປະກອນໃໝ່ຕ້ອງ OTP',
    en: 'Session idle limit: 1 hour · New devices require OTP',
  },
  noProductionData: {
    lo: 'ຍັງບໍ່ມີຂໍ້ມູນຈິງໃນ Production — ລໍຖ້າ Owner ອະນຸຍາດ release',
    en: 'No production customer data loaded — awaiting Owner release authorization',
  },
} as const;

export function t(key: keyof typeof UI_COPY, locale: UiLocale): string {
  return UI_COPY[key][locale];
}
