# Security Findings — Milestone 10

## Critical / High
None open. All Critical/High items from the Milestone 10 audit suite are mitigated by existing controls or new tests.

## Medium

| ID | Finding | Owner | Risk | Plan |
|----|---------|-------|------|------|
| M10-M1 | Recovery document `private/` prefix enforced in application service, not DB CHECK | Platform | Medium — mis-call could insert non-private path if service bypassed | Add DB CHECK `document_storage_key LIKE 'private/%'` in Milestone 11 prep |
| M10-M2 | Backoffice shell is readiness UI without full interactive forms yet | Product | Medium — incomplete operator UX until Customer PWA gate | Build interactive screens after Gate 10 in remaining milestones |
| M10-M3 | Notification providers are pluggable but only in-memory adapter covered in CI | Platform | Medium — SMS/push adapter contract needs Staging soak | Add Staging provider contract tests before Production release auth |

## Low

| ID | Finding | Owner | Risk | Plan |
|----|---------|-------|------|------|
| M10-L1 | Lao/En nav uses dual labels; long Lao strings may truncate on very narrow phones | Design | Low | Continue overflow-wrap; visual QA on 320px during Milestone 11 |
| M10-L2 | Example error alert is static demo copy in shell | Design | Low | Wire to real API errors when screens go interactive |
| M10-L3 | Restore drill compares row counts, not byte-level restore | Ops | Low | Expand to file restore rehearsal in Staging before go-live |

## Production readiness affirmations
- `EGO_POS_ENABLED` cannot be `true` in any env (schema guard)
- Production `/v1/auth/capabilities` reports `smsProvider: external` (mock only when `APP_ENV=local`)
- UI apps do not embed service-role secrets
- No Production customer/order data loaded in this environment
