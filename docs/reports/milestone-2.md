# Milestone Report 2 — Store, Contract, Payout และ Fulfillment

```text
MILESTONE: 2 — Store, Contract, Payout และ Fulfillment
STATUS: PASS (awaiting Owner Review Gate 2)
IMPLEMENTED:
- Store domain: contacts, risk profile, onboarding checklist, private docs + signed access logs
- Phase 1 single active fulfillment location constraint
- Immutable contract versions (markup/commission/fee/mixed) + child-order snapshots by effective date
- Payout account versions with Finance request, Owner+2FA approval, 48h hold, Owner alert
- Rolling 30-day quality counters, auto/manual suspension, reactivate with evidence, audit events
FILES / MIGRATIONS:
- supabase/migrations/20260903090000_store_domain.sql
- supabase/migrations/20260903090100_contracts_and_payouts.sql
- supabase/migrations/20260903090200_store_quality_controls.sql
- apps/api/src/modules/stores/*
VALIDATION:
- Typecheck: PASS
- Lint: PASS
- Unit/Integration: PASS (API 30 tests incl. M2 store suite)
- Permission/RLS: PASS (prior + store service-role paths)
- Build: PASS
- pnpm audit --audit-level=high: PASS
SECURITY / DATA / MONEY / STOCK IMPACT:
- Store documents private with audited signed access
- Contract/payout versions immutable / non-overwritable
- Integer LAK per-order fee fields
- Suspended stores visible but not orderable
KNOWN ISSUES:
- Real object storage (R2) signed URL provider still abstracted; tokens stored in private.signed_access_tokens
COMMIT:
- (filled after push)
DEPLOYMENT:
- ไม่ได้ deploy
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone 2 (OWNER REVIEW GATE 2)
```
