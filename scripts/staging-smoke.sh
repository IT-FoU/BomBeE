#!/usr/bin/env bash
# Staging smoke checks. Defaults to local health contract when STAGING_API_URL unset.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="${STAGING_API_URL:-}"
CUSTOMER_URL="${STAGING_CUSTOMER_URL:-}"
MODE="remote"

if [[ -z "$API_URL" ]]; then
  MODE="local-contract"
  echo "STAGING_API_URL unset — validating health contract via unit tests + fixture seed."
  pnpm --filter @bombee/config --filter @bombee/api run test -- src/modules/system/health.test.ts src/modules/staging/
  TMP_SEED="$(mktemp -t bombee-staging-seed.XXXXXX.json)"
  node scripts/seed-staging-qa.mjs --count=100 --out="$TMP_SEED"
  node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    if (data.productCount < 100 || data.productCount > 500) process.exit(1);
    if (!data.invites?.length) process.exit(1);
    console.log(JSON.stringify({ ok:true, mode:'local-contract', productCount:data.productCount }, null, 2));
  " "$TMP_SEED"
  rm -f "$TMP_SEED"
  exit 0
fi

echo "=== Staging smoke against $API_URL ==="
health="$(curl -fsS "$API_URL/health")"
echo "$health" | node -e '
  let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
    const h=JSON.parse(raw);
    if (h.status!=="ok") process.exit(1);
    if (h.egoPosEnabled===true) { console.error("EGO must stay disabled"); process.exit(1); }
    if (h.productionHold!==true) { console.error("productionHold must be true in Phase 1"); process.exit(1); }
    if (h.env==="production") { console.error("smoke must not target production"); process.exit(1); }
    if (h.integrationsMode==="live") { console.error("live integrations blocked"); process.exit(1); }
    console.log(JSON.stringify({ ok:true, health:h }, null, 2));
  });
'

caps="$(curl -fsS "$API_URL/v1/auth/capabilities")"
echo "$caps" | node -e '
  let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
    const c=JSON.parse(raw);
    if (c.inviteOnlyEnabled!==true && process.env.REQUIRE_INVITE_ONLY==="1") process.exit(1);
    if (c.productionHold!==true) process.exit(1);
    console.log(JSON.stringify({ ok:true, capabilities:c }, null, 2));
  });
'

if [[ -n "$CUSTOMER_URL" ]]; then
  curl -fsS -o /dev/null -w "customer_http=%{http_code}\n" "$CUSTOMER_URL/"
fi

echo "Smoke PASS ($MODE)"
