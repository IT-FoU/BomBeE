# ADR 0002: Package Manager and TypeScript Strict Mode

- Status: Accepted
- Date: 2026-09-03
- Deciders: Cloud Agent (Milestone 0), pending Owner confirmation

## Context

The workspace needs reproducible installs, strict typing for money/stock/auth code, and CI that fails on type and lint regressions.

## Decision

- Package manager: **pnpm** with `packageManager` field and committed lockfile
- Node.js: **22.x** (`.nvmrc`)
- TypeScript: **strict** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` where practical)
- Linting: ESLint flat config with import boundaries between apps/packages
- Formatting: Prettier

Important dependency versions are pinned in workspace `package.json` files (no floating `*` ranges for runtime deps).

## Consequences

- `pnpm install --frozen-lockfile` is the only supported CI install path.
- Type errors block merge via CI.
- Developers must use the pinned Node/pnpm versions.
