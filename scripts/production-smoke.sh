#!/usr/bin/env bash
# Production smoke — requires PUBLIC Production API URL.
set -euo pipefail

API_URL="${PRODUCTION_API_URL:-${PUBLIC_API_URL:-}}"
if [[ -z "$API_URL" ]]; then
  echo "BLOCKED: PRODUCTION_API_URL / PUBLIC_API_URL unset — cannot smoke Production."
  exit 3
fi

if echo "$API_URL" | grep -Eqi 'localhost|127\.0\.0\.1|staging'; then
  echo "REFUSED: refusing to treat local/staging URL as Production smoke target: $API_URL"
  exit 2
fi

echo "=== Production smoke against $API_URL ==="
health="$(curl -fsS "$API_URL/health")"
echo "$health" | node -e '
  let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
    const h=JSON.parse(raw);
    if (h.status!=="ok") process.exit(1);
    if (h.env!=="production") { console.error("expected env=production"); process.exit(1); }
    if (h.egoPosEnabled===true) { console.error("EGO must stay disabled"); process.exit(1); }
    if (h.productionHold===true) { console.error("productionHold still true — authorization flag not set in runtime"); process.exit(1); }
    if (h.integrationsMode==="live") {
      console.warn("WARNING: live integrations enabled — confirm Owner live credentials approval");
    }
    console.log(JSON.stringify({ ok:true, health:h }, null, 2));
  });
'

echo "Production smoke PASS"
