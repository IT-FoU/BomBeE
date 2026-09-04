# Supabase / PostgreSQL — BomBee Market

## Environments

| Env | Purpose | Credentials |
| --- | ------- | ----------- |
| Local | Dev + CI (PGlite or local Supabase) | Mock only — never Production keys |
| Staging | Pre-release QA | Staging project secret store |
| Production | Private beta+ | Production secret store; Owner-gated |

Config templates:

- `supabase/config.toml` — local CLI defaults
- `.env.*.example` — URL/key placeholders without secrets

Hard rule: Local/Staging must not reuse Production Supabase projects or service-role keys (`@bombee/config` env guards).

## Migration naming

```text
YYYYMMDDHHMMSS_short_description.sql
```

Apply order is lexicographic. Every migration must be reviewed for apply + rollback/recovery notes (see file headers).

## Schemas

| Schema | Exposure | Contents |
| ------ | -------- | -------- |
| `app` | Data API / authenticated clients with RLS | Customer-facing and staff-readable tables |
| `private` | Service role / API only | Internal operational data |
| `security` | Service role / API only | Auth devices, OTP, audit, exports, lockouts |
| `finance` | Service role / API only | Reserved for payment/settlement (Milestone 6+) |

## Money and time

- Money columns: `bigint` integer LAK (kip), never `numeric`/`float` for currency
- Timestamps: `timestamptz` stored UTC; display timezone `Asia/Vientiane`

## Testing

- CI runs SQL migrations against PGlite (`apps/api` integration suite)
- Optional local Postgres: `docker compose up -d` then `pnpm db:migrate`
- Full hosted Supabase projects are provisioned by Owner outside this repo
