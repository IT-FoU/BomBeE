# API contract (Phase 1 equivalent)

OpenAPI full export is deferred; this contract mirrors shipped HTTP surface + module services.

## HTTP (apps/api)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `status`, `env`, `egoPosEnabled`, `inviteOnlyEnabled`, `integrationsMode`, `productionHold` |
| GET | `/` | Brand + env flags |
| GET | `/v1/auth/capabilities` | SMS provider mode, idle/lock policy, invite/integrations/hold flags |
| POST | `/v1/auth/otp/request` | Request OTP (mock SMS local; may return `devCode` only when APP_ENV=local) |
| POST | `/v1/auth/otp/verify` | Verify OTP + create session |

## Domain services (in-process; tested via Vitest + PGlite)

Identity/OTP, RBAC, audit/exports, stores/contracts/payouts/quality, catalog/media/pricing,
inventory/reservations, parent/child orders + state machine, payment ledger + COD/QR,
fulfillment/returns/recall/settlement, promotions/reviews/privacy/support,
reports/notifications/search/EGO placeholder/backup, staging invites.

## Auth / money invariants
- Trusted claims built server-side only (`buildTrustedClaims`)
- No client-held service-role secrets
- `EGO_POS_ENABLED` must remain false
- `INTEGRATIONS_MODE=live` rejected until Owner written credentials approval
- `productionHold: true` while Phase 1 Production Hold is active

## Evolution
OpenAPI: [`docs/openapi.yaml`](./openapi.yaml)
