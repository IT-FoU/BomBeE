#!/usr/bin/env bash
# Production deploy — requires written Owner order + Production secret store.
# Usage: bash scripts/production-deploy.sh [dry-run|apply]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dry-run}"
TAG="${PRODUCTION_TAG:-}"
AUTHORIZED="${OWNER_PRODUCTION_DEPLOY_APPROVED:-}"

echo "=== BomBee Production Deploy ==="
echo "mode=$MODE"
echo "tag=${TAG:-<unset>}"
echo "owner_authorized=${AUTHORIZED:-false}"

if [[ "$AUTHORIZED" != "true" && "$AUTHORIZED" != "1" ]]; then
  echo "REFUSED: OWNER_PRODUCTION_DEPLOY_APPROVED must be true."
  echo "Written Owner phrase required (example: 'อนุมัติ deploy production')."
  echo "Then set OWNER_PRODUCTION_DEPLOY_APPROVED=true in the Production secret store."
  exit 2
fi

if [[ "${EGO_POS_ENABLED:-false}" == "true" ]]; then
  echo "REFUSED: EGO_POS_ENABLED must remain false in Phase 1."
  exit 2
fi

if [[ "${INTEGRATIONS_MODE:-sandbox}" == "live" && "${OWNER_LIVE_CREDENTIALS_APPROVED:-}" != "true" ]]; then
  echo "REFUSED: INTEGRATIONS_MODE=live requires OWNER_LIVE_CREDENTIALS_APPROVED=true"
  exit 2
fi

echo "Running quality gates..."
pnpm check
bash scripts/check-no-secrets.sh
bash scripts/validate-migrations.sh

if [[ "$MODE" == "dry-run" ]]; then
  cat <<'EOF'
PRODUCTION DRY-RUN complete (authorization recorded path OK).
Apply requirements (secret store — never commit):
  1. PRODUCTION_DATABASE_URL / SUPABASE_* Production project
  2. PUBLIC_* Production URLs
  3. APP_ENV=production NODE_ENV=production
  4. INVITE_ONLY_ENABLED=true
  5. INTEGRATIONS_MODE=sandbox until live credentials approved separately
  6. EGO_POS_ENABLED=false
  7. OWNER_PRODUCTION_DEPLOY_APPROVED=true
  8. PRODUCTION_TAG=vX.Y.Z (promoted from RC)
  9. Host wiring (Fly/Railway/Vercel/etc.) — none is configured in-repo yet
Then: bash scripts/production-deploy.sh apply
EOF
  exit 0
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Usage: bash scripts/production-deploy.sh [dry-run|apply]"
  exit 1
fi

missing=0
for key in PRODUCTION_DATABASE_URL PRODUCTION_SUPABASE_URL PUBLIC_API_URL PUBLIC_CUSTOMER_URL PUBLIC_BACKOFFICE_URL; do
  if [[ -z "${!key:-}" ]]; then
    echo "MISSING: $key"
    missing=1
  fi
done

if [[ -z "$TAG" ]]; then
  echo "MISSING: PRODUCTION_TAG (e.g. v0.12.0)"
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  echo "BLOCKED: Production credentials / tag / public URLs not available in this environment."
  echo "Authorization is recorded, but apply cannot invent a host or secrets."
  exit 3
fi

if [[ -z "${PRODUCTION_DEPLOY_COMMAND:-}" ]]; then
  echo "BLOCKED: PRODUCTION_DEPLOY_COMMAND unset."
  echo "No in-repo host adapter (Dockerfile/fly/vercel) exists yet."
  echo "Set PRODUCTION_DEPLOY_COMMAND to your platform deploy invocation after wiring hosting."
  exit 4
fi

echo "Executing PRODUCTION_DEPLOY_COMMAND for tag $TAG ..."
bash -lc "$PRODUCTION_DEPLOY_COMMAND"

echo "Post-deploy smoke..."
PRODUCTION_API_URL="${PUBLIC_API_URL}" bash scripts/production-smoke.sh

echo "Production apply finished."
