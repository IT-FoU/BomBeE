# Monitoring and Error Tracking Recipients

## Minimum signals
- API `/health` uptime (Staging)
- 5xx rate, OTP send failures, payment ledger write failures
- Backup job failures (`private.backup_alerts`)
- Queue depth for notification outbox / dead letters

## Recipients (store outside git)
| Severity | Who |
| --- | --- |
| Sev-1 money/stock/auth | Owner + on-call Ops |
| Sev-2 staging outage | Ops |
| Sev-3 noisy client errors | Weekly digest to Ops |

## Configuration notes
- Error tracker project must be named `bombee-staging` (never share Production DSN in Staging)
- PII scrubbing: strip phone OTP payloads and payment references from client breadcrumbs
- `productionHold: true` remains exposed on health for operators

## Verification
Document DSN location in secret store; confirm a test error reaches the Staging project only.
