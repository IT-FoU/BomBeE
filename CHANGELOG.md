# Changelog

All notable changes to BomBee Market are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
