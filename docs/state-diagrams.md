# Order / Payment / Inventory / Settlement state diagrams (Phase 1)

## Child order (source: `stateMachine.ts`)

```text
pending_supplier
  → confirmed | partial_confirmed | cancelled
partial_confirmed
  → confirmed | awaiting_payment | awaiting_cod | partial_cancelled | cancelled
confirmed
  → awaiting_payment | awaiting_cod | packing | partial_cancelled | cancelled
awaiting_payment / awaiting_cod
  → packing | cancelled | partial_cancelled
packing → ready → handed_to_courier → in_transit → delivered
in_transit / delivered / delivery_failed → return_requested → refunded
terminal: cancelled | refunded
```

Cancel allowed only **before** courier handoff (except return/refund paths).

## Parent order
Aggregates children: `pending_supplier` → `partial_confirmed` → `awaiting_payment` → `in_progress` → `completed` / `cancelled` / `partial_cancelled`.

## Payment ledger
- Append-only entries: charge, allocation, receipt, refund, adjustment, COD deposit/fail-restore
- Duplicate webhook confirmation rejected (idempotent)

## Inventory
- Available = on-hand − reserved − holds (ledger formula in inventory rules)
- QR/COD reservations expire or convert on payment events
- Lots enforce shelf-life gates

## Settlement
- Only delivered + paid children enter settlement batches
- Maker-checker + dispute hold + negative carry-forward
