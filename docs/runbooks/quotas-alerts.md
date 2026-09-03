# Quotas and Alerts Checklist (Cloud / Supabase / R2)

## Purpose
Keep Private Beta inside free-tier / budgeted quotas and fail loudly before silent outages.

## Checklist
- [ ] Supabase project is **Staging** (not Production)
- [ ] DB size, egress, auth MAU, and edge function quotas recorded
- [ ] Object storage (R2/S3-compatible) bucket is Staging-only; lifecycle rules for search images (24h) verified
- [ ] CDN / hosting bandwidth alert at 70% and 90% of monthly budget
- [ ] Alert recipients: Owner + designated Ops (emails/phones listed in secret store, not in git)
- [ ] Synthetic seed ≤ 500 products — do not load Production dumps
- [ ] Backup storage URI is isolated from Production vault

## Alert channels
- Platform email/webhook → Ops inbox
- Critical backup failure → same recipients as `private.backup_alerts` handling

## Pass criteria
Quotas documented, alerts configured or explicitly deferred with Owner risk acceptance in
`docs/reports/m12-known-issues-risk-acceptance.md`.
