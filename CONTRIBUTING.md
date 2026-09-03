# Contributing to BomBee Market

## Prerequisites

- Node.js 22.x (pinned via `.nvmrc`)
- pnpm 10.x (see `packageManager` in root `package.json`)
- Docker (optional, for local Postgres/Supabase in later milestones)

## Getting Started

```bash
git clone https://github.com/IT-FoU/BomBeE.git
cd BomBeE
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
```

## Workspace Layout

| Path | Purpose |
| ---- | ------- |
| `apps/customer` | Customer PWA (React + TypeScript) |
| `apps/backoffice` | Staff backoffice (React + TypeScript) |
| `apps/api` | Modular monolith API (TypeScript) |
| `packages/shared` | Shared types, money helpers, constants |
| `packages/config` | Shared ESLint / TypeScript / env schemas |
| `docs/adr` | Architecture Decision Records |
| `docs/reports` | Milestone reports and QA evidence |

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Production build for all packages |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm lint` | ESLint with import boundaries |
| `pnpm test` | Unit / integration tests |
| `pnpm test:e2e` | End-to-end tests (placeholder until Milestone 1+) |
| `pnpm check` | typecheck + lint + test + build |

## Workflow

1. Read `requirements.md` and `tasks.md` before coding.
2. Work from a feature branch off `main` (`cursor/<name>-35e5` for agent branches).
3. Keep changes scoped to the active Milestone checkbox.
4. Never weaken or skip failing tests to force a green suite.
5. Commit without secrets; use mock fixtures only.
6. Open a pull request; do not push directly to `main` when branch protection is enabled.
7. Stop at each **OWNER REVIEW GATE** and wait for Owner acceptance.

## Code Standards

- TypeScript strict mode everywhere
- Server decides authorization, pricing, stock, and payment state
- Integer LAK for all money fields
- UTC storage; Laos timezone for display
- Migrations for every schema change (from Milestone 1)

## License

Proprietary — see `LICENSE`. Owner selects final license terms.
