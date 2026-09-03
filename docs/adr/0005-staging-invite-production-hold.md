# ADR 0005: Staging invite-only and Production Hold

## Status
Accepted — Milestone 12

## Context
Private Beta must not allow open registration. Production deploy is Owner-gated separately from Staging readiness.

## Decision
- Default `INVITE_ONLY_ENABLED=true` for `staging` and `production` APP_ENV
- Persist invites in `app.beta_invites` / `app.beta_invite_redemptions`
- Default `INTEGRATIONS_MODE` to `mock` (local) or `sandbox` (staging/production); reject `live` until schema/policy is deliberately opened after Owner written approval
- Expose `productionHold: true` on health/capabilities for Phase 1
- Provide dry-run Staging deploy + smoke scripts; no Production deploy path

## Consequences
- Staging can proceed with synthetic seeds and invite codes
- Agents and CI cannot silently enable live payments/SMS
- Owner Review Gate 12 approval ≠ Production authorization
