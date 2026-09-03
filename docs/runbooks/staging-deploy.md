# Staging Deploy Runbook

## Scope
Deploy **Staging only** from a tagged / Owner-approved commit. Production remains under **PRODUCTION HOLD**.

## Preconditions
- Owner approved Milestones 0–11
- `STAGING_TAG` points at an RC tag (e.g. `rc-v0.12.0`)
- Staging credentials from secret store only (never committed)
- `APP_ENV=staging`
- `EGO_POS_ENABLED=false`
- `INTEGRATIONS_MODE=sandbox` (or `mock`) — **not** `live` until Owner credentials + written approval
- `INVITE_ONLY_ENABLED=true`

## Procedure
1. `bash scripts/staging-deploy.sh dry-run` — must pass `pnpm check`, secret scan, migrations validate
2. Load Staging secrets into the shell / platform secret store
3. Apply SQL migrations from the RC commit to Staging DB
4. `node scripts/seed-staging-qa.mjs --count=250`
5. Start API / Customer / Backoffice against Staging URLs
6. `STAGING_API_URL=... bash scripts/staging-smoke.sh`
7. `pnpm test:e2e` with Staging customer URL
8. Record results in `docs/reports/milestone-12-staging-hold.md`

## Hard stops
- Any Production URL, key, or `APP_ENV=production` → abort
- Live bank/SMS/courier credentials without Owner written approval → abort
- Missing invite-only gate on Staging → abort

## Rollback
See `docs/runbooks/incident-response-rollback.md`
