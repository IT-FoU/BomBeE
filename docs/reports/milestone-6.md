# Milestone Report 6 — QR, COD, Payment Ledger และ Reconciliation

```text
MILESTONE: 6 — QR, COD, Payment Ledger และ Reconciliation
STATUS: PASS (awaiting Owner Review Gate 6)
IMPLEMENTED:
- Payment ledger: request / attempt / receipt / allocation / refund / adjustment (immutable rows)
- Idempotent confirm via bank/courier reference + attempt idempotency key
- QR after supplier confirmation; combined multi-store allocations; same-day ≥2h deadline
- Evidence pending until money confirmed; overpay → excess refund; underpay → top-up QR
- COD eligibility (new-customer limit, deposit, fail→force QR, restore after successful QR)
- Courier remittance separate from delivery proof; bank + COD daily reconcile
- Adjustment dual approval (Finance + Owner); self-approval denied
FILES / MIGRATIONS:
- supabase/migrations/20260903130000_payment_ledger.sql
- apps/api/src/modules/payments/*
VALIDATION:
- Typecheck/Lint/Build: PASS
- Unit/Integration: PASS (API payment suite included)
- pnpm audit --audit-level=high: PASS
SECURITY / DATA / MONEY / STOCK IMPACT:
- Integer LAK only; ledger append-only; unique bank refs prevent double credit
- Delivered status remains separate from money-received
KNOWN ISSUES:
- Delivery/return/settlement flows continue in Milestone 7
COMMIT:
- (see git log on cursor/milestone-6-payments-recon-35e5)
DEPLOYMENT:
- ไม่ได้ deploy
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone 6 (OWNER REVIEW GATE 6)
```
