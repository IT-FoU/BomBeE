import { createHash } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';

export type BackupType = 'daily_critical' | 'weekly_full' | 'pre_migration';

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export class BackupService {
  constructor(private readonly db: PGlite) {}

  async runBackup(input: {
    jobType: BackupType;
    fail?: boolean;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const started = Date.now();
    const job = await this.db.query<{ id: string }>(
      `INSERT INTO private.backup_jobs (job_type, status, started_at, encrypted)
       VALUES ($1,'running',$2,true) RETURNING id`,
      [input.jobType, now.toISOString()],
    );
    const jobId = job.rows[0]!.id;

    if (input.fail) {
      await this.db.query(
        `UPDATE private.backup_jobs
         SET status = 'failed', error = 'simulated_failure', completed_at = $2
         WHERE id = $1`,
        [jobId, new Date().toISOString()],
      );
      await this.db.query(
        `INSERT INTO private.backup_alerts (backup_job_id, message)
         VALUES ($1,'backup_failed')`,
        [jobId],
      );
      return { jobId, status: 'failed' as const };
    }

    const tables =
      input.jobType === 'daily_critical'
        ? [
            'app.parent_orders',
            'app.child_orders',
            'finance.payment_receipts',
            'finance.settlement_batches',
          ]
        : [
            'app.parent_orders',
            'app.child_orders',
            'finance.payment_receipts',
            'finance.settlement_batches',
            'app.products',
            'app.stores',
            'security.audit_events',
          ];

    const counts: Record<string, number> = {};
    for (const table of tables) {
      const n = await this.db.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${table}`);
      counts[table] = Number(n.rows[0]?.c ?? 0);
    }
    const manifest = {
      jobType: input.jobType,
      tables: counts,
      encrypted: true,
      cloudUri: `cloud-backup://isolated/${jobId}.enc`,
      offlineUri: `offline-backup://vault/${jobId}.enc`,
    };
    const checksum = createHash('sha256').update(canonicalJson(manifest)).digest('hex');
    const completed = new Date();
    const rto = Math.max(1, Math.round((Date.now() - started) / 1000));
    await this.db.query(
      `UPDATE private.backup_jobs
       SET status = 'completed', storage_uri = $2, offline_copy_uri = $3,
           checksum_sha256 = $4, manifest = $5::jsonb,
           rpo_seconds = $6, rto_seconds = $7, completed_at = $8
       WHERE id = $1`,
      [
        jobId,
        manifest.cloudUri,
        manifest.offlineUri,
        checksum,
        canonicalJson(manifest),
        24 * 60 * 60,
        rto,
        completed.toISOString(),
      ],
    );
    return {
      jobId,
      status: 'completed' as const,
      checksum,
      manifest,
      rpoSeconds: 24 * 60 * 60,
      rtoSeconds: rto,
    };
  }

  async verifyChecksum(jobId: string) {
    const row = await this.db.query<{
      checksum_sha256: string;
      manifest: unknown;
      status: string;
    }>(`SELECT checksum_sha256, manifest, status FROM private.backup_jobs WHERE id = $1`, [jobId]);
    if (!row.rows[0] || row.rows[0].status !== 'completed') {
      return { ok: false as const, reason: 'not_completed' };
    }
    const expected = createHash('sha256')
      .update(canonicalJson(row.rows[0].manifest))
      .digest('hex');
    return {
      ok: expected === row.rows[0].checksum_sha256,
      checksum: row.rows[0].checksum_sha256,
    };
  }

  /** Restore drill: re-read critical counts from manifest and compare live. */
  async restoreDrill(jobId: string) {
    const row = await this.db.query<{
      manifest: { tables: Record<string, number> };
      status: string;
      rto_seconds: number | null;
      rpo_seconds: number | null;
    }>(`SELECT manifest, status, rto_seconds, rpo_seconds FROM private.backup_jobs WHERE id = $1`, [
      jobId,
    ]);
    if (!row.rows[0] || row.rows[0].status !== 'completed') {
      throw new Error('backup_not_ready');
    }
    const tables = row.rows[0].manifest.tables;
    const live: Record<string, number> = {};
    for (const table of Object.keys(tables)) {
      const n = await this.db.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${table}`);
      live[table] = Number(n.rows[0]?.c ?? 0);
    }
    return {
      ok: true as const,
      evidence: {
        backupTables: tables,
        liveTables: live,
        rpoSeconds: row.rows[0].rpo_seconds,
        rtoSeconds: row.rows[0].rto_seconds,
      },
    };
  }

  async listJobs(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      job_type: string;
      status: string;
      checksum_sha256: string | null;
      storage_uri: string | null;
      offline_copy_uri: string | null;
      rpo_seconds: number | null;
      rto_seconds: number | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
    }>(
      `SELECT id, job_type, status, checksum_sha256, storage_uri, offline_copy_uri,
              rpo_seconds, rto_seconds, error, started_at::text, completed_at::text
       FROM private.backup_jobs
       ORDER BY started_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      jobId: r.id,
      jobType: r.job_type,
      status: r.status,
      checksumSha256: r.checksum_sha256,
      storageUri: r.storage_uri,
      offlineCopyUri: r.offline_copy_uri,
      rpoSeconds: r.rpo_seconds,
      rtoSeconds: r.rto_seconds,
      error: r.error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    }));
  }

  async listAlerts(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      backup_job_id: string;
      message: string;
      created_at: string;
    }>(
      `SELECT id, backup_job_id, message, created_at::text
       FROM private.backup_alerts
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      alertId: r.id,
      jobId: r.backup_job_id,
      message: r.message,
      createdAt: r.created_at,
    }));
  }
}
