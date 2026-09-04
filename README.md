# BomBee Market

Online marketplace for Vientiane. Phase 1 is a **Managed Reseller / Private Beta** platform: staff load catalog and stock; origin stores pack; couriers deliver.

> Planning baseline: [`requirements.md`](./requirements.md) · Task checklist: [`tasks.md`](./tasks.md)

## Status

**Phase 1 packaging: CLOSED** (2026-09-04)

- Owner Gates **0–12** approved
- Production live **deferred** — no Supabase Production DB yet; use **mock / local** path
- Release tag: `v0.12.0` · Deploy packaging: see `docs/runbooks/production-deploy.md`
- Briefing: [`docs/reports/why-production-blocked.md`](./docs/reports/why-production-blocked.md)
- Final report: [`docs/reports/final-completion-report.md`](./docs/reports/final-completion-report.md)
- Next steps: [`docs/NEXT-STEPS.md`](./docs/NEXT-STEPS.md)

EGO POS integration is **disabled** and must stay off for Phase 1.

## Stack

| Layer | Choice |
| --- | --- |
| Customer / Backoffice | React + TypeScript (PWA for customer) |
| API | TypeScript modular monolith |
| Database / Auth | Supabase PostgreSQL + RLS (PGlite in CI/tests) |
| Money | Integer LAK (kip) only |

## Repository

| Item | Value |
| --- | --- |
| GitHub | [`IT-FoU/BomBeE`](https://github.com/IT-FoU/BomBeE) |
| Default branch | `main` |
| License | Proprietary (see `LICENSE`; Owner may change) |

## Quick start (local / mock)

```bash
git clone https://github.com/IT-FoU/BomBeE.git
cd BomBeE
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
pnpm seed:staging-qa
pnpm staging:smoke
```

Optional apps:

```bash
pnpm dev
```

## Production (when Supabase Production is ready)

1. Create Supabase Production project (separate from Staging)
2. Add GitHub Environment `production` secrets — see `docs/runbooks/production-deploy.md`
3. Set `OWNER_PRODUCTION_DEPLOY_APPROVED=true`
4. Run Actions → **Production Deploy** (confirm `DEPLOY-PRODUCTION`, tag `v0.12.0`)

Do **not** commit secrets. Keep `EGO_POS_ENABLED=false` and `INTEGRATIONS_MODE=sandbox` until live credentials are approved separately.
