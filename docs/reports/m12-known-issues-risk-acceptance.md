# Milestone 12 — Known Issues and Owner Risk Acceptance

## Known issues (accepted for Private Beta on Staging)

| ID | Issue | Impact | Mitigation | Owner decision |
| --- | --- | --- | --- | --- |
| KI-12-01 | Live SMS/bank/courier credentials not loaded | Staging uses mock/sandbox only | Manual fallback runbooks | Pending acceptance |
| KI-12-02 | Staging host credentials may be absent in CI agent | Deploy script stays dry-run | Owner/Ops applies with secret store | Pending acceptance |
| KI-12-03 | Legal/privacy Lo+En copy needs local human review | Compliance residual | Checklist in `docs/runbooks/legal-privacy-review.md` | Pending sign-off |
| KI-12-04 | Monitoring DSN not committed (by design) | Alerts configured outside git | Secret store + monitoring runbook | Pending acceptance |
| KI-12-05 | EGO POS disabled | No POS sync in Phase 1 | Integration Center placeholder only | Accepted (Phase 1 rule) |
| KI-12-06 | Production not deployed | No public Production URL | **PRODUCTION HOLD** | Required |

## Risk acceptance statement (Owner)

> I understand BomBee Market Phase 1 is cleared for **Staging / invite-only Private Beta** packaging only.
> I accept the residual risks in KI-12-01…KI-12-05 for Staging.
> I confirm **Production deploy is NOT authorized** until I issue a separate written order.

| Field | Value |
| --- | --- |
| Owner name | _pending_ |
| Date | _pending_ |
| Staging go / no-go | _pending_ |
| Production authorization | **HOLD — not granted by Milestone 12 approval alone** |

## Notes
Approving Owner Review Gate 12 (Staging readiness) does **not** authorize Production.
Production requires an explicit written deploy order after Final Completion Checklist items for Production are satisfied.
