# Migration naming convention (Milestone 1+)

Filename pattern:

```text
YYYYMMDDHHMMSS_short_description.sql
```

Example: `20260903120000_create_private_schemas.sql`

## Rules

- Always reversible or documented recovery path
- Test apply + rollback/recovery before merge
- Never put Production credentials in migrations
- No real customer data in seed migrations

Milestone 0 intentionally has **zero** SQL files. The CI job `migration-validate` enforces this layout.

See also: `requirements.md` §0 item 7 and Milestone 1 tasks.
