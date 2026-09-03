# Requirements alignment (Phase 1)

Cross-check of `requirements.md` against implemented milestones 0–12.

| Area | Status |
| --- | --- |
| Managed reseller / Vientiane Private Beta | Implemented (invite-only Staging packaging) |
| Integer LAK only | Enforced in schema + money helpers |
| Parent/child multi-store orders | M5 |
| Inventory ledger + reservations | M4 |
| QR / COD + reconciliation | M6 |
| Delivery / returns / recall / settlement | M7 |
| Promos / reviews / privacy / support | M8 |
| Reports / notifications / search / backup | M9 |
| Backoffice QA + security audit | M10 |
| Customer PWA | M11 |
| Staging / Private Beta / Production Hold | M12 |
| EGO POS | **Disabled** (Phase 1 hard rule) |
| Production deploy | **HOLD** — not authorized |

## Gaps deferred (documented, not blocking Gate 12)
- Live SMS/bank/courier credentials (Owner-supplied)
- Human legal copy sign-off residual (KI-12-03)
- Full OpenAPI file (equivalent contract in `docs/api-contract.md`)
- Live Staging host E2E (needs Staging secret store)

## Verdict
Code + tests align with Phase 1 requirements for Staging/Private Beta packaging.
Production launch requirements remain gated on written Owner deploy order.
