# API contract (Phase 1 equivalent)

OpenAPI full export is deferred; this contract mirrors shipped HTTP surface + module services.

## HTTP (apps/api)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `status`, `env`, `egoPosEnabled`, `inviteOnlyEnabled`, `integrationsMode`, `productionHold` |
| GET | `/` | Brand + env flags |
| GET | `/v1/auth/capabilities` | SMS provider mode, idle/lock policy, invite/integrations/hold flags |
| POST | `/v1/auth/otp/request` | Request OTP (mock SMS local; may return `devCode` only when APP_ENV=local). When invite-only, requires valid `inviteCode`. |
| POST | `/v1/auth/otp/verify` | Verify OTP + create session |
| GET | `/v1/auth/me` | Bearer session → identity summary |
| POST | `/v1/auth/logout` | Revoke session (`sessionToken` body or Bearer) |
| GET | `/v1/invites` | List beta invites (local ops) |
| POST | `/v1/invites` | Create beta invite |
| GET | `/v1/stores` | List stores |
| POST | `/v1/stores` | Create store draft (`onboarding`) |
| GET | `/v1/catalog/categories` | Non-prohibited categories |
| GET | `/v1/catalog/products` | Active products + approved prices + `availableQty` (local seed) |
| GET | `/v1/inventory/stock?variantId=` | Lot balances + available qty for a variant |
| POST | `/v1/carts` | Create cart (customer Bearer) |
| POST | `/v1/carts/:id/items` | Upsert cart line |
| POST | `/v1/carts/:id/checkout` | Create parent/child orders (no payment) |
| GET | `/v1/orders` | List recent parent orders + child summaries (local ops) |
| GET | `/v1/orders/:parentId` | Order views for owning customer |
| POST | `/v1/orders/:parentId/cancel` | Cancel before courier handoff (releases stock; cancels open QR) |
| POST | `/v1/orders/:parentId/confirm-children` | Local/mock supplier confirm |
| POST | `/v1/orders/:parentId/payments/qr` | Create QR + reserve stock for order lines |
| POST | `/v1/orders/:parentId/payments/cod` | Create COD shipments + reserve stock (confirmed children) |
| GET | `/v1/cod/shipments` | List COD shipments (local ops) |
| POST | `/v1/cod/shipments/:id/mock-remit` | Local/mock courier remittance + COD reconcile (does not change delivery) |
| GET | `/v1/payments/:id` | Payment request status |
| POST | `/v1/payments/:id/mock-confirm` | Local/mock evidence + confirm |
| POST | `/v1/payments/mock-expire-due` | Local/mock expire open QR past deadline + release stock + cancel `awaiting_payment` children; also grace-expire reservations |
| POST | `/v1/orders/:parentId/fulfillment/mock-advance` | Local/mock packing → courier handoff → `in_transit` (paid children only; consumes QR reservations at handoff) |
| POST | `/v1/orders/:parentId/fulfillment/mock-deliver` | Local/mock POD + `delivered` for `in_transit` children |

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
