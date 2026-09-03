export const PROHIBITED_CATEGORY_SLUGS = [
  'drugs',
  'weapons',
  'tobacco',
  'alcohol',
  'illegal-goods',
] as const;

export const MEDIA_LIMITS = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  },
  video: {
    maxBytes: 50 * 1024 * 1024,
    maxDurationSeconds: 120,
    mimeTypes: ['video/mp4', 'video/webm'] as const,
  },
} as const;

export type LocaleCopy = {
  lo: { title: string; description?: string; specifications?: string; warnings?: string };
  en: { title: string; description?: string; specifications?: string; warnings?: string };
};

export function assertNotProhibitedCategory(slug: string): void {
  if ((PROHIBITED_CATEGORY_SLUGS as readonly string[]).includes(slug)) {
    throw new Error('prohibited_category');
  }
}

export function assertAuthenticBrandClaim(input: {
  claimsAuthenticBrand: boolean;
  brandVerified: boolean;
}): void {
  if (input.claimsAuthenticBrand && !input.brandVerified) {
    throw new Error('authentic_brand_evidence_required');
  }
}

export function assertShelfLifeFields(input: {
  hasShelfLife: boolean;
  productionDate?: string;
  expiryDate?: string;
  ingredients?: string;
  warnings?: string;
}): void {
  if (!input.hasShelfLife) return;
  if (!input.productionDate || !input.expiryDate || !input.ingredients || !input.warnings) {
    throw new Error('shelf_life_fields_required');
  }
}

export function validateMediaUpload(input: {
  mediaType: 'image' | 'video';
  mimeType: string;
  byteSize: number;
  durationSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const limits = MEDIA_LIMITS[input.mediaType];
  if (!(limits.mimeTypes as readonly string[]).includes(input.mimeType)) {
    return { ok: false, reason: 'mime_not_allowed' };
  }
  if (input.byteSize > limits.maxBytes) {
    return { ok: false, reason: 'file_too_large' };
  }
  if (input.mediaType === 'video') {
    if (input.durationSeconds === undefined) return { ok: false, reason: 'duration_required' };
    if (input.durationSeconds > MEDIA_LIMITS.video.maxDurationSeconds) {
      return { ok: false, reason: 'duration_too_long' };
    }
  }
  return { ok: true };
}

export function marginLak(sellingPriceLak: number, costLak: number): number {
  if (!Number.isInteger(sellingPriceLak) || !Number.isInteger(costLak)) {
    throw new Error('prices_must_be_integer_lak');
  }
  return sellingPriceLak - costLak;
}

export function isBelowCost(sellingPriceLak: number, costLak: number): boolean {
  return sellingPriceLak < costLak;
}
