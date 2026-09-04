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
      const byBarcode = await this.db.query<{
        id: string;
        sku: string;
        barcode: string | null;
        title_en: string;
        title_lo: string;
      }>(
        `SELECT pv.id, pv.sku, pv.barcode,
                coalesce(pt_en.title, '') AS title_en,
                coalesce(pt_lo.title, '') AS title_lo
         FROM app.product_variants pv
         JOIN app.products p ON p.id = pv.product_id
         LEFT JOIN app.product_translations pt_en
           ON pt_en.product_id = p.id AND pt_en.locale = 'en'
         LEFT JOIN app.product_translations pt_lo
           ON pt_lo.product_id = p.id AND pt_lo.locale = 'lo'
         WHERE pv.barcode = $1 AND pv.status = 'active'`,
        [input.barcodeValue],
      );
      if (byBarcode.rows.length) {
        return byBarcode.rows.map((r) => ({
          variantId: r.id,
          sku: r.sku,
          barcode: r.barcode,
          titleEn: r.title_en,
          titleLo: r.title_lo,
        }));
      }
    }
    if (input.ocrText && input.ocrText.trim()) {
      const q = `%${input.ocrText.trim().toLowerCase()}%`;
      const rows = await this.db.query<{
        id: string;
        sku: string;
        barcode: string | null;
        title_en: string;
        title_lo: string;
      }>(
        `SELECT pv.id, pv.sku, pv.barcode,
                coalesce(pt_en.title, '') AS title_en,
                coalesce(pt_lo.title, '') AS title_lo
         FROM app.product_variants pv
         JOIN app.products p ON p.id = pv.product_id
         LEFT JOIN app.product_translations pt_en
           ON pt_en.product_id = p.id AND pt_en.locale = 'en'
         LEFT JOIN app.product_translations pt_lo
           ON pt_lo.product_id = p.id AND pt_lo.locale = 'lo'
         WHERE pv.status = 'active'
           AND (
             lower(pv.sku) LIKE $1
             OR lower(coalesce(pt_en.title,'')) LIKE $1
             OR lower(coalesce(pt_lo.title,'')) LIKE $1
           )
         LIMIT 20`,
        [q],
      );
      return rows.rows.map((r) => ({
        variantId: r.id,
        sku: r.sku,
        barcode: r.barcode,
        titleEn: r.title_en,
        titleLo: r.title_lo,
      }));
    }
    return [];
  }

  async listUploads(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      content_type: string;
      byte_size: number;
      ocr_text: string | null;
      barcode_value: string | null;
      expires_at: string;
      deleted_at: string | null;
      created_at: string;
    }>(
      `SELECT id, content_type, byte_size, ocr_text, barcode_value,
              expires_at::text, deleted_at::text, created_at::text
       FROM app.search_image_uploads
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      uploadId: r.id,
      contentType: r.content_type,
      byteSize: r.byte_size,
      ocrText: r.ocr_text,
      barcodeValue: r.barcode_value,
      expiresAt: r.expires_at,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
    }));
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
