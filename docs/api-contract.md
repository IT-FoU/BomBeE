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
| GET | `/v1/stores/documents` | List store onboarding documents (optional `storeId`) |
| GET | `/v1/stores/contacts` | List store contacts (optional `storeId`) |
| POST | `/v1/ops/stores/:storeId/contacts/mock-add` | Local/mock add store contact |
| GET | `/v1/stores/document-expiry-alerts` | List document expiry alerts (`filter=all|due|expired`) |
| POST | `/v1/ops/stores/documents/mock-evaluate-expiry` | Local/mock backdate/verify expired doc + suspend store |
| GET | `/v1/stores/:storeId/onboarding` | Checklist + docs + fulfillment + activation gate |
| POST | `/v1/ops/stores/:storeId/documents/mock-upload` | Local/mock upload onboarding document |
| POST | `/v1/ops/stores/documents/:documentId/verify` | Verify document + checklist flag |
| POST | `/v1/ops/stores/documents/:documentId/signed-access` | Issue short-lived signed access token |
| POST | `/v1/ops/stores/:storeId/fulfillment/mock-ensure` | Ensure one active fulfillment location |
| POST | `/v1/ops/stores/:storeId/activate` | Activate store when checklist+fulfillment ready |
| GET | `/v1/stores/contracts` | List store contract versions (optional `storeId`) |
| POST | `/v1/ops/stores/contracts/mock-create` | Local/mock immutable contract version |
| GET | `/v1/payouts/requests` | List payout change requests + account versions |
| POST | `/v1/ops/payouts/mock-propose` | Local/mock pending payout account change |
| POST | `/v1/ops/payouts/:requestId/approve` | Approve payout change (Owner+2FA; 48h hold) |
| GET | `/v1/stores/quality` | Quality events + suspensions (optional `storeId`) |
| POST | `/v1/ops/stores/quality/mock-event` | Local/mock record quality event(s); may suspend |
| POST | `/v1/ops/stores/:id/reactivate` | Local/mock reactivate suspended store with evidence |
| GET | `/v1/catalog/categories` | Non-prohibited categories |
| GET | `/v1/catalog/products` | Active products + approved prices + `availableQty` (local seed) |
| GET | `/v1/ops/catalog/products` | Ops product/variant status list (`status=all\|draft\|active…`) |
| POST | `/v1/ops/catalog/brands/mock-create` | Local/mock create brand |
| POST | `/v1/ops/catalog/products/mock-create` | Local/mock create draft product |
| POST | `/v1/ops/catalog/variants/mock-create` | Local/mock create draft variant |
| POST | `/v1/ops/catalog/products/:id/status` | Set product status (`draft\|pending_approval\|active\|paused\|archived`) |
| POST | `/v1/ops/catalog/variants/:id/status` | Set variant status |
| GET | `/v1/catalog/import/batches` | List catalog import batches (local ops) |
| POST | `/v1/ops/catalog/import/preview` | Local/mock preview import (idempotent; default sample row) |
| POST | `/v1/ops/catalog/import/:batchId/commit` | Commit valid preview batch (rejects invalid rows) |
| POST | `/v1/ops/catalog/import/:batchId/rollback` | Roll back preview/failed batch (rejects committed) |
| GET | `/v1/catalog/media` | List product media (optional `productId` / `variantId`) |
| POST | `/v1/ops/catalog/media/mock-upload` | Local/mock upload image/video media |
| POST | `/v1/ops/catalog/media/:mediaId/signed-url` | Issue short-lived signed access token |
| GET | `/v1/inventory/stock?variantId=` | Lot balances + available qty for a variant |
| GET | `/v1/inventory/balances/:balanceId/reconcile` | Ledger vs balance reconcile report |
| POST | `/v1/ops/inventory/safety-buffer` | Local/mock set safety buffer (updates existing balances) |
| GET | `/v1/inventory/adjustments` | List inventory adjustment requests (local ops) |
| POST | `/v1/ops/inventory/lots/mock-create` | Local/mock create lot + ensure zero balance |
| POST | `/v1/ops/inventory/receive` | Local/mock receive units onto a balance |
| POST | `/v1/ops/inventory/adjust` | Local/mock adjust (one-shot maker≠approver) |
| GET | `/v1/inventory/import/batches` | List stock import batches (local ops) |
| POST | `/v1/ops/inventory/import/preview` | Local/mock stock import preview (idempotent) |
| POST | `/v1/ops/inventory/import/:batchId/commit` | Commit preview batch (applies import deltas) |
| POST | `/v1/carts` | Create cart (customer Bearer) |
| POST | `/v1/carts/:id/items` | Upsert cart line |
| POST | `/v1/carts/:id/checkout` | Create parent/child orders; optional `promoCode` (percent-off; seed `LOCAL10`) |
| GET | `/v1/orders` | List recent parent orders + child summaries (local ops) |
| GET | `/v1/orders/split-shipments` | List split shipment requests (local ops) |
| POST | `/v1/ops/orders/split-shipments/mock-request` | Local/mock create pending split shipment |
| POST | `/v1/ops/orders/split-shipments/:id/approve` | Approve split (owner≠maker) |
| POST | `/v1/ops/orders/:parentId/confirm-children` | Local ops supplier confirm (no customer session) |
| POST | `/v1/ops/orders/:parentId/fulfillment/mock-advance` | Local ops packing→in_transit |
| POST | `/v1/ops/orders/:parentId/fulfillment/mock-deliver` | Local ops POD→delivered |
| GET | `/v1/settlements` | List settlement batches (local ops) |
| GET | `/v1/settlements/carryforwards` | List store balance carryforwards + collection requests |
| POST | `/v1/ops/settlements/mock-carryforward` | Local/mock negative carryforward (optional collection) |
| POST | `/v1/ops/settlements/mock-create` | Local/mock draft batch for delivered+paid children (optional `store_id`) |
| GET | `/v1/settlements/:batchId/lines` | Settlement lines for a batch |
| POST | `/v1/ops/settlements/:batchId/submit` | Local/mock submit draft → `pending_approval` |
| POST | `/v1/ops/settlements/:batchId/approve` | Local/mock approve (distinct finance actor; maker-checker) |
| POST | `/v1/ops/settlements/:batchId/dispute` | Local/mock dispute a line (`child_order_id` optional → first line) |
| POST | `/v1/ops/settlements/:batchId/hold-line` | Local/mock hold a line (`child_order_id` optional → first unheld); recomputes held/net |
| GET | `/v1/support/tickets` | List support tickets (local ops; `escalated=true` optional) |
| GET | `/v1/me/support/tickets` | List own support tickets (Bearer) |
| POST | `/v1/me/support/tickets` | Open support ticket (Bearer) |
| POST | `/v1/me/support/tickets/:id/confirm-close` | Customer confirm-close after resolve |
| POST | `/v1/me/support/tickets/:id/reopen` | Customer reopen a closed ticket |
| POST | `/v1/ops/support/tickets/mock-create` | Local/mock open ticket (seeded customer) |
| POST | `/v1/ops/support/tickets/mock-evaluate-sla` | Local/mock evaluate SLA breaches + escalate |
| POST | `/v1/ops/support/tickets/mock-auto-close` | Local/mock auto-close stale `resolved_pending_confirm` |
| POST | `/v1/ops/support/tickets/:id/reply` | Local/mock staff reply → `awaiting_customer` |
| POST | `/v1/ops/support/tickets/:id/resolve` | Local/mock preliminary resolve |
| GET | `/v1/returns` | List return requests (local ops) |
| GET | `/v1/delivery-claims` | List delivery lost/damaged claims (local ops) |
| POST | `/v1/ops/delivery-claims/mock-open` | Local/mock open claim on delivered shipment (default damaged) |
| POST | `/v1/ops/delivery-claims/:claimId/resolve` | Resolve or reject open claim (`status` resolved\|rejected) |
| GET | `/v1/packing-deadlines` | List packing SLA deadlines (`late=true` optional) |
| POST | `/v1/ops/packing-deadlines/mock-evaluate` | Local/mock schedule overdue confirm + evaluate late |
| GET | `/v1/couriers` | List couriers + latest contract (local ops) |
| POST | `/v1/ops/couriers/mock-create` | Local/mock create courier + contract v1 |
| GET | `/v1/me/returns` | List own return requests (Bearer) |
| POST | `/v1/me/returns` | Request return for owned delivered child (Bearer) |
| POST | `/v1/ops/returns/mock-create` | Local/mock return for delivered child (optional `child_order_id`) |
| POST | `/v1/ops/returns/:id/approve` | Local/mock approve pending return |
| POST | `/v1/ops/returns/:id/append-communication` | Local/mock append support note (`from`,`text`) |
| GET | `/v1/promotions` | List promotions (local ops) |
| GET | `/v1/recalls` | List product recalls (local ops) |
| POST | `/v1/ops/recalls/mock-start` | Local/mock start recall (archives product; tracks affected) |
| POST | `/v1/ops/recalls/:id/contact` | Local/mock contact affected + auto-complete when clear |
| POST | `/v1/ops/promotions/mock-create` | Local/mock create active promotion |
| POST | `/v1/ops/promotions/:id/pause` | Local/mock pause active promotion |
| GET | `/v1/refunds` | List refund approvals (local ops) |
| GET | `/v1/pricing/requests` | List price change requests (local ops) |
| POST | `/v1/ops/pricing/mock-propose` | Local/mock propose price (optional `belowCost`) |
| POST | `/v1/ops/pricing/:requestId/approve` | Approve price (maker≠approver; below-cost Owner+2FA) |
| GET | `/v1/pricing/near-expiry` | List near-expiry discount requests |
| POST | `/v1/ops/pricing/near-expiry/mock-propose` | Local/mock near-expiry discount (links lot when available) |
| POST | `/v1/ops/pricing/near-expiry/:id/approve` | Approve near-expiry discount (maker≠approver) |
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
| GET | `/v1/staff` | Role catalog defaults + staff directory (local ops) |
| POST | `/v1/ops/identity/mock-lock` | Local/mock lock non-owner staff (default catalog maker; 5 failed logins) |
| POST | `/v1/ops/staff/:identityId/unlock` | Unlock locked staff (Owner actor; no self/owner unlock) |
| POST | `/v1/ops/staff/:staffProfileId/roles/mock-assign` | Local/mock assign APP_ROLE to staff profile |
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
| POST | `/v1/me/phone-change/start` | Dual OTP phone change start (Bearer; local returns `devOldCode`/`devNewCode`) |
| POST | `/v1/me/phone-change/confirm` | Confirm phone change with both OTP codes |
| POST | `/v1/me/recovery-document` | Submit private encrypted recovery document (`private/` key) |
| GET | `/v1/privacy/deletion-requests` | List deletion requests (local ops) |
| GET | `/v1/privacy/recovery-requests` | List recovery document requests (local ops) |
| POST | `/v1/ops/privacy/deletion-requests/:id/approve` | Approve + anonymize (orders retained) |
| GET | `/v1/reviews` | List product reviews (optional `productId`) |
| POST | `/v1/reviews` | Create verified-purchase review (Bearer; delivered child) |
| PATCH | `/v1/reviews/:id` | Edit own review within 7 days (Bearer; versions retained) |
| GET | `/v1/reviews/responses` | List supplier review responses (optional `reviewId`) |
| GET | `/v1/tiktok-links` | List TikTok link submissions |
| POST | `/v1/tiktok-links` | Customer submit TikTok URL (HTTPS allowlist) |
| POST | `/v1/ops/reviews/mock-create` | Local/mock delivered order + verified review |
| POST | `/v1/ops/reviews/:id/supplier-response` | Local/mock submit supplier reply (pending approval) |
| POST | `/v1/ops/reviews/responses/:id/approve` | Local/mock approve supplier reply |
| POST | `/v1/ops/tiktok-links/mock-submit` | Local/mock submit TikTok (`as` staff/supplier/customer) |
| POST | `/v1/ops/tiktok-links/:id/moderate` | Local/mock approve or reject TikTok |
| GET | `/v1/orders/:parentId` | Order views for owning customer |
| POST | `/v1/orders/:parentId/cancel` | Cancel before courier handoff (releases stock; cancels open QR) |
| POST | `/v1/orders/:parentId/confirm-children` | Local/mock supplier confirm |
| POST | `/v1/orders/:parentId/payments/qr` | Create QR + reserve stock for order lines |
| POST | `/v1/orders/:parentId/payments/cod` | Create COD shipments + reserve stock (confirmed children) |
| GET | `/v1/cod/shipments` | List COD shipments (local ops) |
| POST | `/v1/cod/shipments/:id/mock-remit` | Local/mock courier remittance + COD reconcile (does not change delivery) |
| GET | `/v1/cod/profiles` | List COD customer profiles (fails / QR-forced) |
| POST | `/v1/ops/cod/profiles/mock-failure` | Local/mock customer-caused COD failure (2nd → QR forced) |
| POST | `/v1/ops/cod/profiles/:customerIdentityId/restore` | Restore COD eligibility (staff audit) |
| GET | `/v1/cod/redelivery-fees` | List redelivery fees |
| POST | `/v1/ops/cod/redelivery-fees/mock-require` | Local/mock require redelivery fee (default 15k LAK) |
| GET | `/v1/payments/:id` | Payment request status |
| POST | `/v1/payments/:id/mock-confirm` | Local/mock evidence + confirm |
| POST | `/v1/payments/mock-expire-due` | Local/mock expire open QR past deadline + release stock + cancel `awaiting_payment` children; also grace-expire reservations |
| GET | `/v1/payments/mismatches` | List recon mismatches (local ops) |
| GET | `/v1/payments/daily-totals-proof` | Day receipt total + per-child allocation proof (`?day=YYYY-MM-DD`, default UTC today) |
| GET | `/v1/payments/adjustments` | List payment adjustments (local ops) |
| POST | `/v1/ops/payments/:paymentRequestId/reconcile-bank` | Local/mock bank reconcile for payment request (may open mismatches) |
| POST | `/v1/ops/payments/reconcile-bank` | Local/mock bank reconcile (`paymentRequestId` optional; else latest) |
| POST | `/v1/ops/payments/mismatches/mock-create` | Local/mock open recon mismatch |
| POST | `/v1/ops/payments/mismatches/:id/resolve` | Resolve mismatch (optional pending adjustment; maker = catalog-maker) |
| POST | `/v1/ops/payments/adjustments/:id/approve` | Approve payment adjustment (maker≠approver) |
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
