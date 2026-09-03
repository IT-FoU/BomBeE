# PRODUCTION HOLD

## Status
**ACTIVE** — BomBee Market Phase 1 must not be deployed to Production.

## What is allowed
- Local development
- Staging deploy from RC tags with Staging credentials
- Invite-only Private Beta on Staging
- Mock / sandbox integrations

## What is forbidden without a separate written Owner order
- Setting public Production DNS
- Loading Production secrets into any runtime
- `INTEGRATIONS_MODE=live`
- Opening unrestricted customer signup on Production
- Claiming the project “เสร็จ” / complete

## Release candidate
Create with `bash scripts/tag-release-candidate.sh <semver>` (e.g. `0.12.0` → tag `rc-v0.12.0`).
RC tags authorize **Staging** verification only.

## Health contract
API `/health` reports `productionHold: true` while this hold is in force.
