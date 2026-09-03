# Milestone Report 4 — Inventory, Lot, Reservation และ Stock Audit

```text
MILESTONE: 4 — Inventory, Lot, Reservation และ Stock Audit
STATUS: PASS (awaiting Owner Review Gate 4)
IMPLEMENTED:
- Inventory balances per store/location/variant/lot with safety buffers
- Append-only inventory transactions; negative stock rejected + stockout alerts
- Lot policies for food/cosmetics; min shelf life; expiry alerts + discount linkage
- QR reservations expire at payment deadline + 30m; COD until release; idempotent keys
- Ledger reconciliation to zero difference; stock import preview diffs
- Verification due every 3 days schedule rows
FILES / MIGRATIONS:
- supabase/migrations/20260903110000_inventory_ledger.sql
- supabase/migrations/20260903110100_inventory_reservations_lots.sql
- apps/api/src/modules/inventory/*
VALIDATION:
- Typecheck/Lint/Build: PASS
- Unit/Integration: PASS (API 46 tests)
- pnpm audit --audit-level=high: PASS
SECURITY / DATA / MONEY / STOCK IMPACT:
- Stock never negative; reservations use FOR UPDATE locking
- Lot recall/expired/blocked cannot allocate
KNOWN ISSUES:
- True multi-connection concurrency depends on hosted Postgres; PGlite tests cover lock + available checks
COMMIT:
- (filled after push)
DEPLOYMENT:
- ไม่ได้ deploy
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone 4 (OWNER REVIEW GATE 4)
```
