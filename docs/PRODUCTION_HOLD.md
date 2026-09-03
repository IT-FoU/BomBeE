# PRODUCTION HOLD

## Status
**AUTHORIZED — APPLY BLOCKED ON INFRASTRUCTURE**

Owner written order received: **「อนุมัติ deploy production」** (2026-09-03).

Authorization flag for runtimes:
```bash
OWNER_PRODUCTION_DEPLOY_APPROVED=true
```

Health semantics:
- `productionDeployAuthorized: true` when the flag is set
- `productionHold: false` when authorized
- Actual Production URL smoke still requires host + secrets

## What is now allowed
- Production deploy scripts / manual `workflow_dispatch` (with secrets)
- Setting Production DNS **after** secrets and host are wired
- Invite-only Production soft launch with `INTEGRATIONS_MODE=sandbox`

## Still forbidden without extra Owner approval
- `INTEGRATIONS_MODE=live` (needs live bank/SMS/courier credentials approval)
- EGO POS enablement
- Claiming the project “เสร็จ” until Production smoke + monitoring checklist pass

## Current blocker in this agent environment
- No Production Supabase/DB credentials available
- No GitHub `production` environment secrets configured (empty / inaccessible)
- No in-repo host adapter (Dockerfile / Fly / Vercel / etc.)

See `docs/runbooks/production-deploy.md`.
