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
| POST | `/v1/carts/:id/checkout` | Create parent/child orders; optional `promoCode` (percent-off; seed `LOCAL10`) |
| GET | `/v1/orders` | List recent parent orders + child summaries (local ops) |
| POST | `/v1/ops/orders/:parentId/confirm-children` | Local ops supplier confirm (no customer session) |
| POST | `/v1/ops/orders/:parentId/fulfillment/mock-advance` | Local ops packing→in_transit |
| POST | `/v1/ops/orders/:parentId/fulfillment/mock-deliver` | Local ops POD→delivered |
| GET | `/v1/settlements` | List settlement batches (local ops) |
| POST | `/v1/ops/settlements/mock-create` | Local/mock draft batch for delivered+paid children (optional `store_id`) |
| GET | `/v1/settlements/:batchId/lines` | Settlement lines for a batch |
| POST | `/v1/ops/settlements/:batchId/submit` | Local/mock submit draft → `pending_approval` |
| POST | `/v1/ops/settlements/:batchId/approve` | Local/mock approve (distinct finance actor; maker-checker) |
| POST | `/v1/ops/settlements/:batchId/dispute` | Local/mock dispute a line (`child_order_id` optional → first line) |
| GET | `/v1/support/tickets` | List support tickets (local ops) |
| GET | `/v1/me/support/tickets` | List own support tickets (Bearer) |
| POST | `/v1/me/support/tickets` | Open support ticket (Bearer) |
| POST | `/v1/me/support/tickets/:id/confirm-close` | Customer confirm-close after resolve |
| POST | `/v1/ops/support/tickets/mock-create` | Local/mock open ticket (seeded customer) |
| POST | `/v1/ops/support/tickets/:id/reply` | Local/mock staff reply → `awaiting_customer` |
| POST | `/v1/ops/support/tickets/:id/resolve` | Local/mock preliminary resolve |
| GET | `/v1/returns` | List return requests (local ops) |
| POST | `/v1/ops/returns/mock-create` | Local/mock return for delivered child (optional `child_order_id`) |
| POST | `/v1/ops/returns/:id/approve` | Local/mock approve pending return |
| GET | `/v1/promotions` | List promotions (local ops) |
| POST | `/v1/ops/promotions/mock-create` | Local/mock create active promotion |
| POST | `/v1/ops/promotions/:id/pause` | Local/mock pause active promotion |
| GET | `/v1/refunds` | List refund approvals (local ops) |
| POST | `/v1/ops/refunds/mock-create` | Local/mock refund request+approval for paid delivered child |
| POST | `/v1/ops/refunds/:approvalId/approve` | Local/mock approve (distinct finance actor) |
| POST | `/v1/ops/refunds/:approvalId/mock-pay` | Local/mock ledger pay |
| GET | `/v1/audit/events` | List recent audit events (local ops) |
| POST | `/v1/ops/audit/mock-event` | Local/mock append audit event |
| GET | `/v1/exports` | List export requests (no ciphertext) |
| POST | `/v1/ops/exports/mock-create` | Local/mock encrypted export request |
| POST | `/v1/ops/exports/:id/approve` | Local/mock approve (distinct actor) |
| POST | `/v1/ops/exports/:id/mock-download` | Local/mock download counter (metadata only) |
| GET | `/v1/notifications` | List inbox + outbox (local ops) |
| POST | `/v1/ops/notifications/mock-enqueue` | Local/mock enqueue inbox+outbox (memory provider) |
| POST | `/v1/ops/notifications/mock-process` | Local/mock process due outbox |
| POST | `/v1/ops/notifications/inbox/:id/mark-read` | Local/mock mark inbox read |
| GET | `/v1/integrations` | Integration Center status (mode flags, checklist, EGO store rows) |
| POST | `/v1/ops/integrations/ego/mock-ensure` | Local/mock ensure disabled EGO profiles for active stores |
| GET | `/v1/staff` | Role catalog defaults + staff directory (local ops, read-only) |
| GET | `/v1/reports/dashboard` | Live dashboard KPIs (local ops; optional `store_id`) |
| GET | `/v1/reports/payments/reconcile` | Payment request vs allocation/receipt reconcile |
| GET | `/v1/backups` | List backup jobs + alerts (local ops) |
| POST | `/v1/ops/backups/mock-run` | Local/mock encrypted backup job (`job_type`, optional `fail`) |
| POST | `/v1/ops/backups/:id/verify` | Local/mock checksum verify |
| POST | `/v1/ops/backups/:id/restore-drill` | Local/mock restore drill evidence |
| GET | `/v1/search/catalog` | Catalog match by `q` and/or `barcode` |
| POST | `/v1/search/image` | Local image-search upload metadata + match (consent search-only; 24h TTL) |
| GET | `/v1/search/uploads` | List recent search image uploads (local ops) |
| POST | `/v1/ops/search/purge-expired` | Local/mock purge expired search uploads |
| GET | `/v1/me/privacy` | Customer profile + addresses (Bearer) |
| POST | `/v1/me/addresses` | Add customer address |
| POST | `/v1/me/marketing-opt-in` | Set marketing opt-in boolean |
| POST | `/v1/me/deletion-request` | Request account deletion (session = OTP gate locally) |
| GET | `/v1/privacy/deletion-requests` | List deletion requests (local ops) |
| POST | `/v1/ops/privacy/deletion-requests/:id/approve` | Approve + anonymize (orders retained) |
| GET | `/v1/reviews` | List product reviews (optional `productId`) |
| POST | `/v1/reviews` | Create verified-purchase review (Bearer; delivered child) |
| GET | `/v1/tiktok-links` | List TikTok link submissions |
| POST | `/v1/tiktok-links` | Customer submit TikTok URL (HTTPS allowlist) |
| POST | `/v1/ops/reviews/mock-create` | Local/mock delivered order + verified review |
| POST | `/v1/ops/tiktok-links/mock-submit` | Local/mock submit TikTok (`as` staff/supplier/customer) |
| POST | `/v1/ops/tiktok-links/:id/moderate` | Local/mock approve or reject TikTok |
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
