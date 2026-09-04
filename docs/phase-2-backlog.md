# Phase 2 backlog (draft)

Phase 1 packaging is closed on `main`. Items below are **not** started until Owner prioritizes them.

## A — Hosted environments (blocked on Owner cloud)

| ID | Item | Depends on |
| --- | --- | --- |
| P2-A1 | Supabase Staging project + hosted E2E | Owner Staging credentials |
| P2-A2 | Supabase Production project + deploy | Owner Production project + host |
| P2-A3 | Live SMS provider for Lao numbers | Owner SMS contract |
| P2-A4 | Bank QR / remittance live mode | Owner bank credentials + written live approval |
| P2-A5 | Courier API adapters beyond manual | Owner courier contracts |
| P2-A6 | Monitoring DSN + alert recipients | Owner Ops inbox |
| P2-A7 | Branch protection on `main` | Owner GitHub admin — `docs/runbooks/branch-protection.md` |

## B — Product / UX polish (can start without Production DB)

| ID | Item | Notes |
| --- | --- | --- |
| P2-B1 | Backoffice interactive forms beyond shell | **Done** — invite + store drafts persist via `/v1/invites` + `/v1/stores` |
| P2-B2 | Customer OTP against real API (still mock SMS locally) | **Done** — `/v1/auth/otp/*`, `/v1/auth/me`, `/v1/auth/logout` + customer client + vite proxy |
| P2-B3 | Legal Lo/En copy human review | **Copy expanded in PWA**; human sign-off still KI-12-03 |
| P2-B4 | Expand OpenAPI from `docs/api-contract.md` | **Done (auth+health+invites+stores)** — `docs/openapi.yaml` |
| P2-B5 | Performance budgets in CI (bundle size check) | **Done** — `scripts/check-customer-bundle-budget.mjs` in CI |
| P2-B6 | Richer synthetic seed into local Postgres | **Done** — `pnpm seed:sql` → `supabase/seed/generated_staging_qa.sql` |
| P2-B7 | Invite redeem on OTP verify + remove demo login fallback | **Done** — verify redeems invite; customer shows API errors only |
| P2-B8 | Customer catalog browse from local API | **Done** — `/v1/catalog/products|categories` + PGlite seed + fixture fallback |
| P2-B9 | Thin checkout HTTP (cart → order, no QR) | **Done** — `/v1/carts*`, `/v1/orders/:id` + customer place-order wiring |
| P2-B10 | Mock QR payment HTTP + customer pay flow | **Done** — confirm-children + QR create + mock-confirm (local/mock only) |
| P2-B11 | Local inventory seed + stock read HTTP | **Done** — seed lots/balances; catalog `availableQty`; `GET /v1/inventory/stock` |
| P2-B12 | Reserve stock at QR create | **Done** — QR create reserves lines; rolls back + cancels QR on insufficient stock |
| P2-B13 | Packing / fulfillment mock-advance | **Done** — `POST .../fulfillment/mock-advance`; seed `LOCAL-MOCK` courier; customer tracking wires to live status |
| P2-B14 | Consume stock on ship + mock POD/deliver | **Done** — `ReservationService.consume` at handoff; `POST .../fulfillment/mock-deliver` |
| P2-B15 | Expire due QR payments + reservations | **Done** — `POST /v1/payments/mock-expire-due` releases stock for expired open QR |
| P2-B16 | Cancel awaiting children on QR expire | **Done** — mock-expire-due cancels allocated `awaiting_payment` children |
| P2-B17 | COD create HTTP + reserve + fulfill path | **Done** — `POST .../payments/cod`; mock-advance/deliver supports COD |
| P2-B18 | Cancel before handoff HTTP | **Done** — `POST .../cancel` releases stock + cancels open QR; customer wired |
| P2-B19 | COD remittance mock HTTP + backoffice list | **Done** — `GET/POST .../cod/shipments`; mock remit + reconcile; Payments section |
| P2-B20 | Orders list HTTP + backoffice Orders | **Done** — `GET /v1/orders`; Orders section shows recent parent/child statuses |
| P2-B21 | Ops fulfillment from backoffice | **Done** — `/v1/ops/orders/.../confirm|mock-advance|mock-deliver`; Orders buttons |
| P2-B22 | Backoffice catalog + inventory views | **Done** — Catalog list + Stock detail via existing `/v1/catalog/products` + `/v1/inventory/stock` |
| P2-B23 | Settlements list + mock create | **Done** — `GET /v1/settlements`, `POST /v1/ops/settlements/mock-create`, seed payouts, Settlements section |
| P2-B24 | Settlement submit / approve / dispute | **Done** — ops submit/approve/dispute + lines GET; Settlements buttons; maker-checker |
| P2-B25 | Support tickets list + mock ops | **Done** — `GET /v1/support/tickets`, mock-create/reply/resolve; Support section |
| P2-B26 | Returns list + mock create/approve | **Done** — `GET /v1/returns`, ops mock-create/approve; Returns section |
| P2-B27 | Promotions list + mock create/pause | **Done** — `GET /v1/promotions`, ops mock-create/pause; Promotions section |
| P2-B28 | Refunds approve/pay + Approvals BO | **Done** — `GET /v1/refunds`, mock-create/approve/mock-pay; Approvals section |
| P2-B29 | Audit events list + mock append | **Done** — `GET /v1/audit/events`, `POST /v1/ops/audit/mock-event`; Audit section |
| P2-B30 | Exports list + mock approve/download | **Done** — `GET /v1/exports`, mock-create/approve/mock-download; Exports section |
| P2-B31 | Notifications inbox/outbox + mock ops | **Done** — `GET /v1/notifications`, mock-enqueue/process/mark-read; Notifications section |
| P2-B32 | Integrations Center mode + EGO status | **Done** — `GET /v1/integrations`, ego mock-ensure; Integrations section from live flags |
| P2-B33 | Staff roles catalog + directory (read-only) | **Done** — `GET /v1/staff` roles+directory; seed local role assignments; Staff section |
| P2-B34 | Reports dashboard KPIs + payment reconcile | **Done** — `GET /v1/reports/dashboard`, `/v1/reports/payments/reconcile`; Dashboard section |
| P2-B35 | Checkout promo code (percent-off) | **Done** — `promoCode` on cart checkout; seed `LOCAL10`; customer checkout field |
| P2-B36 | Backups list + mock run/verify/drill | **Done** — `GET /v1/backups`, mock-run/verify/restore-drill; Backups section |

## C — Hard rules that stay

- `EGO_POS_ENABLED=false` until a future Phase explicitly opens POS
- Integer LAK only
- No Production dumps in Local/Staging
- Invite-only until Owner opens public signup

## Suggested first Phase 2 kickoff

Owner picks either **A1 (Staging host)** or **B1/B2 (UX/API wiring)** as the next milestone gate series.
