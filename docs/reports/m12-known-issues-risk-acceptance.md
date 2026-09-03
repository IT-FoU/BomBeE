# Milestone 12 — Known Issues and Owner Risk Acceptance

## Known issues (accepted for Private Beta on Staging)

| ID | Issue | Impact | Mitigation | Owner decision |
| --- | --- | --- | --- | --- |
| KI-12-01 | Live SMS/bank/courier credentials not loaded | Staging uses mock/sandbox only | Manual fallback runbooks | Accepted for Staging (Gate 12) |
| KI-12-02 | Staging host credentials may be absent in CI agent | Deploy script stays dry-run | Owner/Ops applies with secret store | Accepted for Staging (Gate 12) |
| KI-12-03 | Legal/privacy Lo+En copy needs local human review | Compliance residual | Checklist in `docs/runbooks/legal-privacy-review.md` | Accepted residual — complete before public launch |
| KI-12-04 | Monitoring DSN not committed (by design) | Alerts configured outside git | Secret store + monitoring runbook | Accepted for Staging (Gate 12) |
| KI-12-05 | EGO POS disabled | No POS sync in Phase 1 | Integration Center placeholder only | Accepted (Phase 1 rule) |
| KI-12-06 | Production not deployed | No public Production URL | **PRODUCTION HOLD** | Required — still HOLD |

## Risk acceptance statement (Owner)

> I understand BomBee Market Phase 1 is cleared for **Staging / invite-only Private Beta** packaging only.
> I accept the residual risks in KI-12-01…KI-12-05 for Staging.
> I confirm **Production deploy is NOT authorized** until I issue a separate written order.

| Field | Value |
| --- | --- |
| Owner name | Owner (อนุมัติ via Gate 12) |
| Date | 2026-09-03 |
| Staging go / no-go | **GO** — packaging approved (Gate 12) |
| Production authorization | **HOLD — not granted by Milestone 12 / Gate 12 approval** |

## Notes
Approving Owner Review Gate 12 (Staging readiness) does **not** authorize Production.
Production requires an explicit written deploy order after Final Completion Checklist items for Production are satisfied.
