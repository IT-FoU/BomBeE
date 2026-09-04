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
| P2-B1 | Backoffice interactive forms beyond shell | **Done (invite + store drafts)** |
| P2-B2 | Customer OTP against real API (still mock SMS locally) | **Done (in progress PR)** — `/v1/auth/otp/*` + customer client |
| P2-B3 | Legal Lo/En copy human review | KI-12-03 |
| P2-B4 | Expand OpenAPI from `docs/api-contract.md` | **Done (auth+health)** — `docs/openapi.yaml` |
| P2-B5 | Performance budgets in CI (bundle size check) | **Done** — `scripts/check-customer-bundle-budget.mjs` in CI |
| P2-B6 | Richer synthetic seed into local Postgres | After `docker compose` path |

## C — Hard rules that stay

- `EGO_POS_ENABLED=false` until a future Phase explicitly opens POS
- Integer LAK only
- No Production dumps in Local/Staging
- Invite-only until Owner opens public signup

## Suggested first Phase 2 kickoff

Owner picks either **A1 (Staging host)** or **B1/B2 (UX/API wiring)** as the next milestone gate series.
