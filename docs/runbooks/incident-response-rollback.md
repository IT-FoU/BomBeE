# Incident Response and Rollback Checklist

## Severity
- **Sev-1**: money mismatch, stock corruption, auth bypass, data leak
- **Sev-2**: Staging unavailable, SMS/courier outage with no fallback
- **Sev-3**: UX defects, non-critical reporting gaps

## Immediate actions (all severities)
1. Stop deploying further changes
2. Preserve logs / backup job IDs / ledger batch IDs
3. Notify Owner for Sev-1 within 15 minutes

## Staging rollback
1. Redeploy previous RC tag (`rc-vX.Y.Z`)
2. If schema migrated forward incompatibly → restore Staging DB from last successful backup (`docs/runbooks/backup-restore.md`)
3. Re-run `bash scripts/staging-smoke.sh`
4. Record incident timeline in Ops notes (not customer-visible)

## Production
**PRODUCTION HOLD** — no Production rollback procedure is authorized until Owner writes a Production deploy order.
If Production somehow exists contrary to policy, treat as Sev-1 and freeze immediately.

## Post-incident
- Root cause + corrective action
- Update known issues / risk acceptance if residual risk remains
