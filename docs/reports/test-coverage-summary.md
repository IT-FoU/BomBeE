# Test reports and coverage summary (Phase 1)

Recorded 2026-09-03 after Milestone 12 / Gate 12.

## Suites (local `pnpm check`)

| Package | Tests | Result |
| --- | --- | --- |
| `@bombee/api` | 90 | PASS |
| `@bombee/config` | 7 | PASS |
| `@bombee/shared` | 5 | PASS |
| `@bombee/customer` | 4 | PASS |
| `@bombee/backoffice` | 2 | PASS |
| **Total unit/integration** | **108** | **PASS** |

## Additional gates
- Typecheck / Lint / Build: PASS
- Secret scan / migration validate / dependency audit: PASS (CI PR #13)
- Customer e2e fixture suite: covered under customer package scripts
- Staging smoke: local-contract mode PASS (`scripts/staging-smoke.sh`)
- Staging full E2E against live Staging URL: **pending Staging credentials** (procedure ready)

## Coverage notes
- Domain money/stock/auth paths covered by PGlite integration tests (orders, payments, inventory, RLS, M10 audit)
- Numeric line-coverage % not enforced in CI; regression gate is `pnpm check` + CI workflow
