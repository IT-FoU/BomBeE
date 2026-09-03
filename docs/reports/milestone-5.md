# Milestone Report 5 — Parent/Child Order และ State Machine

```text
MILESTONE: 5 — Parent/Child Order และ State Machine
STATUS: PASS (awaiting Owner Review Gate 5)
IMPLEMENTED:
- Cart grouped by store; checkout revalidates active variant, store acceptance, approved price
- Parent + child orders with unique numbers; immutable item snapshots; combined/store documents
- Strict child status transition matrix; parent status derived (mixed delivered/cancelled → completed + note)
- Transition audit events; replay/out-of-order rejection
- Cancellation preview with promo recalculation; blocked after courier handoff; QR cancel → refund request
- Split shipment requires Admin/Owner approval (no self-approve); shipment items link to order items
FILES / MIGRATIONS:
- supabase/migrations/20260903120000_orders_parent_child.sql
- apps/api/src/modules/orders/*
VALIDATION:
- Typecheck/Lint/Build: PASS
- Unit/Integration: PASS (API 53 tests)
- pnpm audit --audit-level=high: PASS
SECURITY / DATA / MONEY / STOCK IMPACT:
- Order money fields integer LAK; snapshots immutable
- Server-side transition enforcement
KNOWN ISSUES:
- Full payment ledger integration continues in Milestone 6
COMMIT:
- cbf9dec — feat: Milestone 5 parent/child orders and state machine
DEPLOYMENT:
- ไม่ได้ deploy
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone 5 (OWNER REVIEW GATE 5)
```
