#!/usr/bin/env bash
# Apply supabase/migrations/*.sql to DATABASE_URL (local/Staging only).
# Never point this at Production unless Owner has authorized Production migrate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATABASE_URL="${DATABASE_URL:-}"
MODE="${1:-apply}"

if [[ "$MODE" == "list" ]]; then
  ls -1 "$ROOT"/supabase/migrations/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql | xargs -n1 basename | sort
  exit 0
fi

if [[ -z "$DATABASE_URL" ]]; then
  cat <<'EOF'
DATABASE_URL is unset.

Local options:
  1) PGlite (default in CI/tests) — pnpm --filter @bombee/api test
  2) Docker Postgres:
       docker compose up -d
       export DATABASE_URL=postgresql://bombee:bombee@127.0.0.1:54322/bombee
       bash scripts/apply-migrations.sh

EOF
  exit 1
fi

if echo "$DATABASE_URL" | grep -Eqi 'prod|production'; then
  if [[ "${OWNER_PRODUCTION_DEPLOY_APPROVED:-}" != "true" ]]; then
    echo "REFUSED: URL looks Production-like and OWNER_PRODUCTION_DEPLOY_APPROVED is not true"
    exit 2
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker compose ps --status running 2>/dev/null | grep -q bombee-local-db; then
    PSQL=(docker compose exec -T db psql -U bombee -d bombee)
  else
    echo "psql not found. Install PostgreSQL client or use docker compose."
    exit 3
  fi
else
  PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
fi

mapfile -t FILES < <(ls -1 "$ROOT"/supabase/migrations/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql | sort)

echo "=== Apply ${#FILES[@]} migrations ==="
echo "target=${DATABASE_URL%%@*}@…"

# Track applied migrations (compatible with apps/api migrate.ts)
"${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
SQL

for file in "${FILES[@]}"; do
  id="$(basename "$file")"
  exists="$("${PSQL[@]}" -Atc "SELECT 1 FROM public.schema_migrations WHERE id = '$id'" || true)"
  if [[ "$exists" == "1" ]]; then
    echo "skip $id"
    continue
  fi
  echo "apply $id"
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  else
    docker compose exec -T db psql -U bombee -d bombee -v ON_ERROR_STOP=1 <"$file"
  fi
  "${PSQL[@]}" -c "INSERT INTO public.schema_migrations (id) VALUES ('$id')"
done

if [[ -f "$ROOT/supabase/seed/local_synthetic.sql" ]]; then
  echo "seed local_synthetic.sql"
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed/local_synthetic.sql"
  else
    docker compose exec -T db psql -U bombee -d bombee -v ON_ERROR_STOP=1 <"$ROOT/supabase/seed/local_synthetic.sql"
  fi
fi

echo "OK: migrations applied"
