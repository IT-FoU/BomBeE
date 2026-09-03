# Role / Permission matrix (Phase 1)

Implementation: `apps/api/src/modules/rbac/permissions.ts` + shared `PERMISSIONS`.
Tests: `permissions.test.ts`, maker-checker, M10 security audit.

| Role | Default permissions |
| --- | --- |
| owner | all `PERMISSIONS` |
| admin | staff.read, staff.unlock, approvals.decide, customers.read_pii, exports.request, exports.download, audit.read, backoffice.access |
| finance | exports.request, audit.read, backoffice.access |
| operations | staff.read, backoffice.access |
| catalog | backoffice.access |
| support | customers.read_pii, backoffice.access |
| auditor | audit.read, backoffice.access |

## Override rules
- Explicit `allow` / `deny` overrides applied after role defaults
- Self-approval blocked for maker-checker flows
- Backoffice access requires `backoffice.access`

## Customer Private Beta
- Invite redemption gates registration when `INVITE_ONLY_ENABLED=true` (Staging/Production defaults)
