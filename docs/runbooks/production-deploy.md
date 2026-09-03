# Production Deploy Runbook

## Authorization
Written Owner order recorded: **「อนุมัติ deploy production」** (2026-09-03).

Set in Production secret store only (never commit):
```bash
OWNER_PRODUCTION_DEPLOY_APPROVED=true
```

## Preconditions
- RC promoted to release tag (e.g. `v0.12.0` from `rc-v0.12.0`)
- Production Supabase/DB project separate from Staging
- Public Production URLs ready
- `EGO_POS_ENABLED=false`
- `INVITE_ONLY_ENABLED=true` (Private Beta)
- `INTEGRATIONS_MODE=sandbox` until separate live-credentials approval
- Host platform wired (`PRODUCTION_DEPLOY_COMMAND` or CI workflow secrets)

## Procedure
1. `OWNER_PRODUCTION_DEPLOY_APPROVED=true bash scripts/production-deploy.sh dry-run`
2. Load Production secrets into the deploy environment
3. `OWNER_PRODUCTION_DEPLOY_APPROVED=true PRODUCTION_TAG=v0.12.0 bash scripts/production-deploy.sh apply`
4. `PRODUCTION_API_URL=https://… bash scripts/production-smoke.sh`
5. Verify monitoring/backup alerts fire to Owner/Ops
6. Update `docs/reports/final-completion-report.md` with Production URL + smoke evidence

## Current agent/environment blocker
This Cloud Agent workspace has:
- no Production database/Supabase credentials
- no GitHub Production environment secrets (403 / empty)
- no in-repo host adapter (no Dockerfile / Fly / Vercel config)

Authorization is valid; **apply remains blocked until Owner/Ops provides host + secrets**.
