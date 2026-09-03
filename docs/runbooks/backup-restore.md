# Backup and Restore Runbook (Phase 1)

## Scope
- Daily: parent/child orders, payment receipts, settlement batches
- Weekly / pre-migration: full critical + catalog/stores/audit snapshot
- Backups are encrypted, stored on an isolated cloud URI, and copied offline

## Procedures
1. **Daily critical** — `BackupService.runBackup({ jobType: 'daily_critical' })`
2. **Weekly full** — `BackupService.runBackup({ jobType: 'weekly_full' })`
3. **Pre-migration** — run before applying SQL migrations in Staging/Production
4. Verify `checksum_sha256` via `verifyChecksum(jobId)`
5. On failure, `private.backup_alerts` is written; notify Owner/Ops

## Restore drill
1. Select a completed backup job
2. Run `restoreDrill(jobId)` and compare live table counts to manifest
3. Record achieved **RPO** (target ≤ 24h for daily) and **RTO** (seconds measured in drill)
4. Do not open Production until a full restore drill passes

## Offline copy
- Each completed job writes `offline_copy_uri` alongside `storage_uri`
- Offline vault is separate from primary database and cloud object storage
