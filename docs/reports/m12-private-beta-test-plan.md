# Private Beta Test Plan (Phase 1)

## Goal
Validate BomBee Market end-to-end on **Staging** with invite-only access before any Production deploy.

## Principles
- **No fixed user count** — invite gradually; quality of coverage over vanity volume
- Synthetic catalog seed 100–500 items (`scripts/seed-staging-qa.mjs`)
- Mock/sandbox integrations until Owner supplies live credentials
- Stop at **PRODUCTION HOLD** — Private Beta ≠ Production launch

## Access
- `INVITE_ONLY_ENABLED=true`
- Issue codes via `app.beta_invites` (Ops)
- Revoke immediately on abuse

## Test waves (flexible sizing)
| Wave | Focus | Exit |
| --- | --- | --- |
| A — Ops dry run | Auth, catalog browse, cart, QR/COD checkout stubs, order timeline | Smoke + critical path green |
| B — Store partners | Listing, inventory, packing, settlement preview | No stock/money mismatches |
| C — Friendly customers | Full purchase + return/support tickets | SLA timers fire; Lo/En UX usable |

## Coverage matrix (must hit at least once per wave as applicable)
- Multi-store cart / parent-child orders
- QR wait + COD limit/deposit
- Offline guard (checkout blocked offline)
- Invite redemption + exhausted invite
- Support ticket + privacy flows
- Backup restore drill evidence attached

## Out of scope until Owner order
- Production DNS cutover
- Live bank settlement
- Public app-store / unrestricted signup
- EGO POS (remains disabled)
