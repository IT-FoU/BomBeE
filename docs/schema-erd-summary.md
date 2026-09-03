# Schema / ERD summary (Phase 1)

Source of truth: `supabase/migrations/*.sql` (18 files, applied via PGlite in CI).

## Schemas
- `public` — `schema_migrations`
- `security` — identities, sessions, roles, permissions, RLS helpers
- `app` — catalog, orders, payments, fulfillment, promotions, customers, support, invites, notifications, search
- `private` — money unit example, backups, alerts, recovery paths
- `integrations` — EGO placeholder (disabled)

## Domain map (high level)

```text
auth_identities ──┬── sessions / OTP
                  ├── role grants / permission overrides
                  └── customer profiles / addresses

stores ── contracts / payouts / quality
       └── products / media / pricing / lots
              └── inventory ledger + reservations

parent_orders ── child_orders ── shipments / POD / returns / recalls
                     └── payment ledger (allocations, receipts, refunds, COD)
                     └── settlement batches / disputes

promotions / reviews / support tickets
beta_invites / beta_invite_redemptions
backup_jobs / backup_alerts
```

## Money / stock rules
- All monetary amounts: integer **LAK** (`bigint`)
- Inventory available qty derived from ledger + reservations
- Payment mutations append-only via ledger services

## Currency of docs
Update this file when adding migrations. Do not invent Production schema outside migrations.
