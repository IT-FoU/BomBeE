# Changelog

All notable changes to BomBee Market are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 2 local — owner recovery list + mock-create HTTP
- Phase 2 local — lot allocation evaluate + expiry alerts HTTP
- Phase 2 local — courier list + mock-create HTTP
- Phase 2 local — inventory lot mock-create HTTP
- Phase 2 local — catalog brand/product/variant mock-create HTTP
- Phase 2 local — staff role mock-assign HTTP
- Phase 2 local — store contacts list + mock-add HTTP
- Phase 2 local — payment bank reconcile + daily totals proof HTTP
- Phase 2 local — returns append-communication HTTP
- Phase 2 local — catalog import rollback HTTP
- Phase 2 local — inventory ledger reconcile + safety buffer HTTP
- Phase 2 local — catalog product/variant setStatus HTTP
- Phase 2 local — support ticket auto-close stale + customer reopen HTTP
- Phase 2 local — store document expiry alerts list + mock-evaluate suspend HTTP
- Phase 2 local — COD restore + mock-failure + redelivery fee HTTP
- Phase 2 local — support ticket SLA escalated list + mock-evaluate HTTP
- Phase 2 local — packing SLA late list + mock-evaluate HTTP
- Phase 2 local — delivery lost/damaged claims list + mock-open + resolve HTTP
- Phase 2 local — staff identity mock-lock + unlock HTTP
- Phase 2 local — settlement hold-line + negative carryforward HTTP
- Phase 2 local — order split shipment request/approve HTTP
- Phase 2 local — inventory stock import preview/commit HTTP
- Phase 2 local — catalog media list/upload/signed-url HTTP (MediaService wired)
- Phase 2 local — inventory receive + one-shot maker-checker adjust HTTP
- Phase 2 local — store onboarding docs, signed access, activate HTTP
- Phase 2 local — payment mismatch resolve + adjustment approve HTTP

- Phase 2 — API CORS for local apps + invite gate on OTP
- Phase 2 — local invite SQL seed generator (`pnpm seed:sql`)
- Phase 2 start — OTP HTTP API (mock SMS), OpenAPI auth, customer bundle budget CI

- Local Postgres docker compose + migration apply script; Phase 2 backlog; branch-protection Owner runbook

- Phase 1 milestone close — Owner deferred Production live (mock / skip secrets)
  - Final Completion CLOSED; briefing in `docs/reports/why-production-blocked.md`

- Production deploy authorization path (Owner「อนุมัติ deploy production」)
  - `OWNER_PRODUCTION_DEPLOY_APPROVED` env; health hold lifts when set
  - `scripts/production-deploy.sh` / smoke + manual GitHub workflow
  - Apply still blocked without Production host/secrets

- Final Completion Report (PARTIAL) — Gates 0–12 approved; Production HOLD
  - Schema/ERD, API contract, RBAC matrix, state diagrams, test/requirements summaries

- Milestone 12 — Staging, Private Beta readiness, Production Hold
  - Invite-only beta invites schema/service; sandbox/mock integrations guard
  - Staging seed (100–500), deploy dry-run, smoke, RC tag helpers
  - Runbooks + Private Beta plan + risk acceptance; PRODUCTION HOLD active

- Milestone 11 — Customer PWA
  - Installable shell with SW/manifest; discovery, cart/checkout, tracking, offline guards
  - Lo/En UX; multi-store cart in IndexedDB; QR/COD flows; performance budget ADR

- Milestone 10 — Backoffice final QA and security audit
  - Responsive/a11y/Lo-En shell hardening; security audit suite; findings log
  - Production guards: no mock SMS, EGO off, no production data loaded

- Milestone 9 — Reports, notifications, image search, EGO placeholder, backups
  - Live KPIs + ledger reconcile; notification retry inbox; 24h search image purge
  - EGO disabled Integration Center; encrypted daily/weekly backups + restore drill

- Milestone 8 — Promotions, reviews/TikTok, customer privacy, and support
  - Promo stacking/funding/caps; verified reviews; TikTok moderation allowlist
  - Addresses, dual-OTP phone change, recovery/deletion; support SLA tickets

- Milestone 7 — Delivery, returns, recall, and settlement
  - Courier adapters, packing SLA, POD, claims; return/refund SLA via ledger
  - Product recalls with affected-order tracking; settlement batches with disputes

- Milestone 6 — QR/COD payments and reconciliation
  - Immutable payment ledger with allocations, receipts, refunds, adjustments
  - Combined QR flow, COD limits/deposit/fail-restore, bank + remittance reconcile

- Milestone 5 — Parent/child orders and state machine
  - Multi-store checkout, immutable snapshots, cancellation previews, split shipments

- Milestone 4 — Inventory ledger, lots, and reservations
  - Available qty formula, QR/COD reservations, lot shelf-life gates, ledger reconcile

- Milestone 3 — Catalog, media, and price approval
  - Products/variants with bilingual copy, import preview, media limits
  - Immutable price versions with below-cost Owner 2FA approval

- Milestone 2 — Store, contract, payout, and fulfillment controls
  - Store onboarding documents, fulfillment location rule, contract snapshots
  - Payout account versioning with Owner 2FA and 48-hour hold
  - Quality counters and suspension/reactivation workflows

- Milestone 1 — Database, authentication, roles, 2FA, and audit
  - SQL migrations for app/private/security/finance schemas with RLS
  - Identity/OTP/session/lockout services with mock SMS
  - RBAC permission catalog, maker-checker, Owner delegation
  - Append-only audit log and encrypted export workflow
  - PGlite-backed integration tests in CI

- Milestone 0 — Repository and project foundation
  - TypeScript monorepo with `apps/customer`, `apps/backoffice`, `apps/api`, `packages/shared`, `packages/config`
  - Strict TypeScript, ESLint, Prettier, import boundaries, and environment schema validation
  - CI pipeline with lockfile-frozen install, typecheck, lint, unit tests, build, dependency scan, secret scan, and migration validation stub
  - Planning baseline (`requirements.md`, `tasks.md`), ADR directory, and contributor/security docs
