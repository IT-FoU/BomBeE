import { PRODUCTS, type CatalogProduct } from '../data/catalog';

const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return '';
  }
  return DEFAULT_API;
}

type ApiProduct = {
  id: string;
  slug: string;
  titleLo: string;
  titleEn: string;
  storeId: string;
  storeName: string;
  brandId: string | null;
  brandName: string | null;
  categoryId: string;
  categorySlug: string;
  categoryLo: string;
  categoryEn: string;
  priceLak: number;
  compareAtLak: number | null;
  variants: Array<{ id: string; label: string; priceLak: number; sku: string }>;
};

function mapProduct(p: ApiProduct): CatalogProduct {
  return {
    id: p.id,
    slug: p.slug,
    titleLo: p.titleLo,
    titleEn: p.titleEn,
    storeId: p.storeId,
    storeName: p.storeName,
    brandId: p.brandId ?? 'brand-unknown',
    brandName: p.brandName ?? 'Unknown',
    categoryId: p.categorySlug || p.categoryId,
    categoryLo: p.categoryLo,
    categoryEn: p.categoryEn,
    priceLak: p.priceLak,
    compareAtLak: p.compareAtLak ?? undefined,
    image: '/icons/icon-512.svg',
    variants: p.variants.map((v) => ({
      id: v.id,
      label: v.label,
      priceLak: v.priceLak,
    })),
    shippingNoteLo: 'ສົ່ງທ້ອງຖິ່ນ',
    shippingNoteEn: 'Local delivery',
  };
}

/** Fetch active products from local API; fall back to static fixtures if unavailable. */
export async function loadCatalogProducts(): Promise<{
  products: CatalogProduct[];
  source: 'api' | 'fixture';
}> {
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/catalog/products`);
    if (!res.ok) throw new Error(`catalog_http_${res.status}`);
    const body = (await res.json()) as { products?: ApiProduct[] };
    const rows = (body.products ?? []).map(mapProduct);
    if (rows.length === 0) return { products: PRODUCTS, source: 'fixture' };
    return { products: rows, source: 'api' };
  } catch {
    return { products: PRODUCTS, source: 'fixture' };
  }
}
