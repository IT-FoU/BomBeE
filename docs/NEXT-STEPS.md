# Next steps after Phase 1 (Owner)

Phase 1 packaging is on `main` (CI green). Production live was **deferred** until a Supabase Production project exists.

## Now (no cloud DB required)

```bash
git pull origin main
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
pnpm seed:staging-qa
pnpm staging:smoke
pnpm dev
```

Use mock/local only. Do not put Production secrets in git.

### Optional local Postgres (Docker on your machine)

```bash
pnpm db:up
export DATABASE_URL=postgresql://bombee:bombee@127.0.0.1:54322/bombee
pnpm db:migrate
```

Branch protection (Owner GitHub admin): [`docs/runbooks/branch-protection.md`](./runbooks/branch-protection.md)  
Phase 2 ideas: [`docs/phase-2-backlog.md`](./phase-2-backlog.md)

## When Supabase Production is ready

1. Create a **Production** Supabase project (separate from any Staging project)
2. Pick a host (Vercel / Fly / Railway / Cloudflare — Owner choice)
3. Add GitHub Environment `production` secrets — list in [`docs/runbooks/production-deploy.md`](./runbooks/production-deploy.md)
4. Set `OWNER_PRODUCTION_DEPLOY_APPROVED=true` in that secret store
5. Run Actions → **Production Deploy** (`DEPLOY-PRODUCTION`, tag `v0.12.0` or newer)
6. Reply with the Production URL for smoke + monitoring checklist

Keep `EGO_POS_ENABLED=false` and `INTEGRATIONS_MODE=sandbox` until live bank/SMS/courier credentials are approved separately.

## Optional hygiene

- Close any leftover draft milestone PRs in GitHub if they still appear open (superseded by `main`)
- Turn on branch protection for `main` — Agent cannot (403); follow [`docs/runbooks/branch-protection.md`](./runbooks/branch-protection.md)
