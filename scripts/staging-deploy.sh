#!/usr/bin/env bash
# Staging deploy procedure — dry-run by default.
# Actual Staging deploy requires Owner-approved commit tag + Staging credentials.
# NEVER deploys Production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dry-run}"
TAG="${STAGING_TAG:-}"
TARGET_ENV="${APP_ENV:-staging}"

echo "=== BomBee Staging Deploy Guard ==="
echo "mode=$MODE"
echo "target_env=$TARGET_ENV"
echo "tag=${TAG:-<unset>}"

if [[ "$TARGET_ENV" == "production" ]]; then
  echo "REFUSED: Production deploy is under PRODUCTION HOLD."
  echo "Require written Owner order before any Production action."
  exit 2
fi

if [[ "$TARGET_ENV" != "staging" && "$TARGET_ENV" != "local" ]]; then
  echo "REFUSED: Unsupported APP_ENV=$TARGET_ENV"
  exit 2
fi

echo "Checking monorepo quality gate locally..."
pnpm check
bash scripts/check-no-secrets.sh
bash scripts/validate-migrations.sh

if [[ -z "$TAG" ]]; then
  echo "NOTE: STAGING_TAG unset — dry-run will not claim a tagged release."
fi

if [[ "$MODE" == "dry-run" ]]; then
  cat <<'EOF'
DRY-RUN complete.
Next (manual, with Staging secret store only):
  1. Export Staging credentials from secret store (never commit).
  2. Set APP_ENV=staging INTEGRATIONS_MODE=sandbox INVITE_ONLY_ENABLED=true EGO_POS_ENABLED=false
  3. Apply migrations to Staging DB from approved tag.
  4. node scripts/seed-staging-qa.mjs --count=250
  5. bash scripts/staging-smoke.sh
  6. pnpm test:e2e (against Staging URLs)
Production remains HOLD.
EOF
  exit 0
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Usage: bash scripts/staging-deploy.sh [dry-run|apply]"
  exit 1
fi

if [[ -z "${STAGING_DATABASE_URL:-}" || -z "${STAGING_SUPABASE_URL:-}" ]]; then
  echo "BLOCKED: Staging credentials not present in environment."
  echo "Provide STAGING_DATABASE_URL + STAGING_SUPABASE_URL from secret store, or keep dry-run."
  exit 3
fi

if [[ -z "$TAG" ]]; then
  echo "BLOCKED: STAGING_TAG required for apply mode (approved/release-candidate tag)."
  exit 3
fi

echo "APPLY mode is scaffolded only in this repo revision."
echo "Wire your host (Fly/Railway/Vercel/etc.) here after Owner Staging credentials exist."
echo "Refusing to invent a Production-capable deploy path."
exit 4
