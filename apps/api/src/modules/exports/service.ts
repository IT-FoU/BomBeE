import { randomBytes } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';

import {
  approveExport,
  assertExportReason,
  downloadExport,
  encryptExportPayload,
  type ExportAccessEventType,
} from './exports.js';

export class ExportService {
  constructor(
    private readonly db: PGlite,
    private readonly encryptionKey = randomBytes(32),
  ) {}

  async requestExport(input: {
    requesterIdentityId: string;
    exportType: string;
    reason: string;
    payload: Buffer;
  }) {
    assertExportReason(input.reason);
    const artifact = encryptExportPayload(input.payload, this.encryptionKey);
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO security.export_requests
        (requester_identity_id, export_type, reason, artifact_ciphertext, artifact_nonce)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        input.requesterIdentityId,
        input.exportType,
        input.reason,
        artifact.ciphertext,
        artifact.nonce,
      ],
    );
    const id = row.rows[0]!.id;
    await this.log(id, input.requesterIdentityId, 'created');
    return id;
  }

  async approve(input: { exportId: string; actorIdentityId: string; now?: number }) {
    const row = await this.db.query<{
      id: string;
      requester_identity_id: string;
      export_type: string;
      reason: string;
      status: 'pending' | 'approved' | 'rejected' | 'ready' | 'expired' | 'deleted';
      download_limit: number;
      download_count: number;
    }>(
      `SELECT id, requester_identity_id, export_type, reason, status, download_limit, download_count
       FROM security.export_requests WHERE id = $1`,
      [input.exportId],
    );
    const current = row.rows[0];
    if (!current) throw new Error('export not found');

    const approved = approveExport(
      {
        id: current.id,
        requesterIdentityId: current.requester_identity_id,
        exportType: current.export_type,
        reason: current.reason,
        status: current.status,
        downloadLimit: current.download_limit,
        downloadCount: current.download_count,
      },
      input.actorIdentityId,
      input.now ?? Date.now(),
    );

    await this.db.query(
      `UPDATE security.export_requests
       SET status = 'approved', approver_identity_id = $2, approved_at = timezone('utc', now()),
           expires_at = to_timestamp($3 / 1000.0)
       WHERE id = $1`,
      [approved.id, input.actorIdentityId, approved.expiresAt],
    );
    await this.log(approved.id, input.actorIdentityId, 'approved');
    return approved;
  }

  async download(input: { exportId: string; actorIdentityId: string; now?: number }) {
    const row = await this.db.query<{
      id: string;
      requester_identity_id: string;
      export_type: string;
      reason: string;
      status: 'pending' | 'approved' | 'rejected' | 'ready' | 'expired' | 'deleted';
      download_limit: number;
      download_count: number;
      expires_at: string | null;
    }>(
      `SELECT id, requester_identity_id, export_type, reason, status, download_limit, download_count,
              expires_at::text
       FROM security.export_requests WHERE id = $1`,
      [input.exportId],
    );
    const current = row.rows[0];
    if (!current) throw new Error('export not found');

    const result = downloadExport(
      {
        id: current.id,
        requesterIdentityId: current.requester_identity_id,
        exportType: current.export_type,
        reason: current.reason,
        status: current.status,
        downloadLimit: current.download_limit,
        downloadCount: current.download_count,
        expiresAt: current.expires_at ? Date.parse(current.expires_at) : undefined,
      },
      input.now ?? Date.now(),
    );

    if (!result.ok) {
      if (result.reason === 'expired') {
        await this.db.query(`UPDATE security.export_requests SET status = 'expired' WHERE id = $1`, [
          current.id,
        ]);
        await this.log(current.id, input.actorIdentityId, 'expired');
      }
      return result;
    }

    await this.db.query(
      `UPDATE security.export_requests
       SET status = 'ready', download_count = $2
       WHERE id = $1`,
      [current.id, result.next.downloadCount],
    );
    await this.log(current.id, input.actorIdentityId, 'downloaded');
    return result;
  }

  private async log(exportId: string, actorIdentityId: string, eventType: ExportAccessEventType) {
    await this.db.query(
      `INSERT INTO security.export_access_events (export_request_id, actor_identity_id, event_type)
       VALUES ($1,$2,$3)`,
      [exportId, actorIdentityId, eventType],
    );
  }

  async listExports(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      export_type: string;
      reason: string;
      status: string;
      download_count: number;
      download_limit: number;
      requester_identity_id: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT id, export_type, reason, status, download_count, download_limit,
              requester_identity_id, created_at::text, expires_at::text
       FROM security.export_requests
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      exportId: r.id,
      exportType: r.export_type,
      reason: r.reason,
      status: r.status,
      downloadCount: Number(r.download_count),
      downloadLimit: Number(r.download_limit),
      requesterIdentityId: r.requester_identity_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }
}
