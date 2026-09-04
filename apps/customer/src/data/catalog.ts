export type Locale = 'lo' | 'en';

export type CatalogProduct = {
  id: string;
  slug: string;
  titleLo: string;
  titleEn: string;
  storeId: string;
  storeName: string;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryLo: string;
  categoryEn: string;
  priceLak: number;
  compareAtLak?: number;
  image: string;
  videoUrl?: string;
  variants: Array<{ id: string; label: string; priceLak: number }>;
  shippingNoteLo: string;
  shippingNoteEn: string;
  tiktokUrl?: string;
  deal?: boolean;
  availableQty?: number;
};

export const CATEGORIES = [
  { id: 'food', lo: 'ອາຫານ', en: 'Food' },
  { id: 'home', lo: 'ເຮືອນ', en: 'Home' },
  { id: 'beauty', lo: 'ຄວາມງາມ', en: 'Beauty' },
  { id: 'gadgets', lo: 'ອຸປະກອນ', en: 'Gadgets' },
] as const;

export const STORES = [
  { id: 'store-a', name: 'VTE Fresh Mart' },
  { id: 'store-b', name: 'Lane Xang Home' },
  { id: 'store-c', name: 'Blue Lotus Beauty' },
] as const;

export const BRANDS = [
  { id: 'brand-a', name: 'Mekong Pure' },
  { id: 'brand-b', name: 'HouseCraft' },
  { id: 'brand-c', name: 'Lotus Glow' },
] as const;

export const PRODUCTS: CatalogProduct[] = [
  {
    id: 'p1',
    slug: 'drinking-water',
    titleLo: 'ນ້ຳດື່ມ ແພັກ 12',
    titleEn: 'Drinking Water 12-pack',
    storeId: 'store-a',
    storeName: 'VTE Fresh Mart',
    brandId: 'brand-a',
    brandName: 'Mekong Pure',
    categoryId: 'food',
    categoryLo: 'ອາຫານ',
    categoryEn: 'Food',
    priceLak: 45000,
    compareAtLak: 52000,
    image: '/icons/icon-512.svg',
    variants: [
      { id: 'p1-v1', label: '12 bottles', priceLak: 45000 },
      { id: 'p1-v2', label: '24 bottles', priceLak: 82000 },
    ],
    shippingNoteLo: 'ສົ່ງພາຍໃນນະຄອນຫຼວງ 1–2 ວັນ',
    shippingNoteEn: 'Vientiane delivery 1–2 days',
    tiktokUrl: 'https://www.tiktok.com/@bombee/video/1',
    deal: true,
  },
  {
    id: 'p2',
    slug: 'ceramic-mug',
    titleLo: 'ຈອກເຊລາມິກ',
    titleEn: 'Ceramic Mug',
    storeId: 'store-b',
    storeName: 'Lane Xang Home',
    brandId: 'brand-b',
    brandName: 'HouseCraft',
    categoryId: 'home',
    categoryLo: 'ເຮືອນ',
    categoryEn: 'Home',
    priceLak: 89000,
    image: '/icons/icon-512.svg',
    variants: [{ id: 'p2-v1', label: 'Standard', priceLak: 89000 }],
    shippingNoteLo: 'ຫຸ້ມຫໍ່ພິເສດ',
    shippingNoteEn: 'Gift-ready packaging',
  },
  {
    id: 'p3',
    slug: 'aloe-gel',
    titleLo: 'ເຈວອາໂລ',
    titleEn: 'Aloe Gel',
    storeId: 'store-c',
    storeName: 'Blue Lotus Beauty',
    brandId: 'brand-c',
    brandName: 'Lotus Glow',
    categoryId: 'beauty',
    categoryLo: 'ຄວາມງາມ',
    categoryEn: 'Beauty',
    priceLak: 65000,
    compareAtLak: 75000,
    image: '/icons/icon-512.svg',
    videoUrl: 'https://example.com/demo.mp4',
    variants: [
      { id: 'p3-v1', label: '100ml', priceLak: 65000 },
      { id: 'p3-v2', label: '250ml', priceLak: 110000 },
    ],
    shippingNoteLo: 'ສົ່ງທົ່ວປະເທດ',
    shippingNoteEn: 'Nationwide shipping',
    deal: true,
  },
  {
    id: 'p4',
    slug: 'usb-cable',
    titleLo: 'ສາຍ USB-C',
    titleEn: 'USB-C Cable',
    storeId: 'store-b',
    storeName: 'Lane Xang Home',
    brandId: 'brand-b',
    brandName: 'HouseCraft',
    categoryId: 'gadgets',
    categoryLo: 'ອຸປະກອນ',
    categoryEn: 'Gadgets',
    priceLak: 35000,
    image: '/icons/icon-512.svg',
    variants: [{ id: 'p4-v1', label: '1m', priceLak: 35000 }],
    shippingNoteLo: 'ສົ່ງດ່ວນ',
    shippingNoteEn: 'Express ready',
  },
];

export function productTitle(p: CatalogProduct, locale: Locale) {
  return locale === 'lo' ? p.titleLo : p.titleEn;
}
