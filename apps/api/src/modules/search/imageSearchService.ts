import type { PGlite } from '@electric-sql/pglite';

export const SEARCH_IMAGE_TTL_MS = 24 * 60 * 60_000;
export const ALLOWED_SEARCH_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_SEARCH_BYTES = 5 * 1024 * 1024;

export function assertSearchUploadAllowed(input: {
  contentType: string;
  byteSize: number;
  consentSearchOnly: boolean;
  consentTrainAnalytics: boolean;
}) {
  if (!ALLOWED_SEARCH_TYPES.has(input.contentType)) throw new Error('invalid_content_type');
  if (input.byteSize <= 0 || input.byteSize > MAX_SEARCH_BYTES) throw new Error('file_too_large');
  if (!input.consentSearchOnly) throw new Error('search_consent_required');
  if (input.consentTrainAnalytics) throw new Error('train_analytics_consent_forbidden');
}

/** Strip EXIF-like metadata by keeping only raw bytes hash placeholder. */
export function stripUnsafeMetadata(bytes: Uint8Array): Uint8Array {
  // Phase 1: copy buffer (no EXIF writer); real stripper plugs in later.
  return bytes.slice();
}

export class ImageSearchService {
  constructor(private readonly db: PGlite) {}

  async upload(input: {
    customerIdentityId?: string;
    contentType: string;
    byteSize: number;
    consentSearchOnly: boolean;
    consentTrainAnalytics?: boolean;
    ocrText?: string;
    barcodeValue?: string;
    now?: Date;
  }) {
    assertSearchUploadAllowed({
      contentType: input.contentType,
      byteSize: input.byteSize,
      consentSearchOnly: input.consentSearchOnly,
      consentTrainAnalytics: input.consentTrainAnalytics ?? false,
    });
    const now = input.now ?? new Date();
    const id = crypto.randomUUID();
    const storageKey = `private/search/${id}`;
    const expiresAt = new Date(now.getTime() + SEARCH_IMAGE_TTL_MS);
    await this.db.query(
      `INSERT INTO app.search_image_uploads
        (id, customer_identity_id, storage_key, content_type, byte_size,
         consent_search_only, consent_train_analytics, ocr_text, barcode_value, expires_at)
       VALUES ($1,$2,$3,$4,$5,true,false,$6,$7,$8)`,
      [
        id,
        input.customerIdentityId ?? null,
        storageKey,
        input.contentType,
        input.byteSize,
        input.ocrText ?? null,
        input.barcodeValue ?? null,
        expiresAt.toISOString(),
      ],
    );
    return { id, storageKey, expiresAt: expiresAt.toISOString() };
  }

  async searchCatalog(input: { ocrText?: string; barcodeValue?: string }) {
    if (input.barcodeValue) {
      const byBarcode = await this.db.query<{ id: string; sku: string }>(
        `SELECT id, sku FROM app.product_variants
         WHERE barcode = $1 AND status = 'active'`,
        [input.barcodeValue],
      );
      if (byBarcode.rows.length) return byBarcode.rows;
    }
    if (input.ocrText && input.ocrText.trim()) {
      const q = `%${input.ocrText.trim().toLowerCase()}%`;
      return (
        await this.db.query<{ id: string; sku: string }>(
          `SELECT pv.id, pv.sku
           FROM app.product_variants pv
           JOIN app.products p ON p.id = pv.product_id
           LEFT JOIN app.product_translations t ON t.product_id = p.id
           WHERE pv.status = 'active'
             AND (lower(pv.sku) LIKE $1 OR lower(coalesce(t.title,'')) LIKE $1)
           LIMIT 20`,
          [q],
        )
      ).rows;
    }
    return [];
  }

  async purgeExpired(now = new Date()) {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM app.search_image_uploads
       WHERE deleted_at IS NULL AND expires_at <= $1`,
      [now.toISOString()],
    );
    let deleted = 0;
    let failed = 0;
    for (const row of due.rows) {
      try {
        await this.db.query(
          `UPDATE app.search_image_uploads
           SET deleted_at = $2, delete_failed = false WHERE id = $1`,
          [row.id, now.toISOString()],
        );
        deleted += 1;
      } catch {
        await this.db.query(
          `UPDATE app.search_image_uploads SET delete_failed = true WHERE id = $1`,
          [row.id],
        );
        failed += 1;
      }
    }
    return { deleted, failed, due: due.rows.length };
  }
}
