import { createHash, randomBytes } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';

import { validateMediaUpload } from './rules.js';

export class MediaService {
  constructor(private readonly db: PGlite) {}

  async upload(input: {
    productId?: string;
    variantId?: string;
    mediaType: 'image' | 'video';
    mimeType: string;
    byteSize: number;
    durationSeconds?: number;
    widthPx?: number;
    heightPx?: number;
  }) {
    const validation = validateMediaUpload(input);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    // Lightweight content validation stub (malware/content gate)
    if (input.mimeType.includes('script')) {
      throw new Error('content_rejected');
    }

    const storageKey = `private/media/${randomBytes(16).toString('hex')}`;
    const thumbnailKey =
      input.mediaType === 'image' ? `${storageKey}.thumb.webp` : `${storageKey}.poster.webp`;

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO private.product_media
        (product_id, variant_id, media_type, storage_key, mime_type, byte_size,
         duration_seconds, width_px, height_px, thumbnail_key, validation_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'passed')
       RETURNING id`,
      [
        input.productId ?? null,
        input.variantId ?? null,
        input.mediaType,
        storageKey,
        input.mimeType,
        input.byteSize,
        input.durationSeconds ?? null,
        input.widthPx ?? null,
        input.heightPx ?? null,
        thumbnailKey,
      ],
    );
    return { id: row.rows[0]!.id, storageKey, thumbnailKey };
  }

  async issueSignedUrl(input: {
    mediaId: string;
    actorIdentityId: string;
    ttlMs?: number;
    now?: number;
  }) {
    const media = await this.db.query<{ storage_key: string; validation_status: string }>(
      `SELECT storage_key, validation_status FROM private.product_media WHERE id = $1`,
      [input.mediaId],
    );
    const row = media.rows[0];
    if (!row) throw new Error('media_not_found');
    if (row.validation_status !== 'passed') throw new Error('media_not_available');

    const now = input.now ?? Date.now();
    const expiresAt = new Date(now + (input.ttlMs ?? 5 * 60_000)).toISOString();
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    await this.db.query(
      `INSERT INTO private.signed_access_tokens
        (storage_key, actor_identity_id, expires_at)
       VALUES ($1,$2,$3)`,
      [row.storage_key, input.actorIdentityId, expiresAt],
    );
    return { token, expiresAt, storageKey: row.storage_key };
  }
}
