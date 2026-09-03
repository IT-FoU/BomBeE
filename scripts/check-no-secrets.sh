#!/usr/bin/env bash
# Lightweight local secret/data hygiene check for Milestone 0+.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

fail=0

tracked_env="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$' || true)"
if [[ -n "${tracked_env}" ]]; then
  echo "ERROR: tracked .env file found"
  echo "${tracked_env}"
  fail=1
else
  echo "OK: no tracked .env secrets files"
fi

if git ls-files -z | xargs -0 rg -n --hidden \
  -e 'BEGIN (RSA |OPENSSH )?PRIVATE KEY' \
  -e 'sk_live_[0-9a-zA-Z]+' \
  -e 'AKIA[0-9A-Z]{16}' \
  --glob '!.gitleaks.toml' 2>/dev/null; then
  echo "ERROR: potential secret material in tracked files"
  fail=1
else
  echo "OK: no private-key / cloud key patterns in tracked files"
fi

# Fixture JSON must stay synthetic — reject Laos mobile numbers that look like
# placeholders only if they match known real-data export markers.
if rg -n -i 'production dump|pii export|live customer list' tests/fixtures 2>/dev/null; then
  echo "ERROR: fixtures may contain real data markers"
  fail=1
else
  echo "OK: fixtures look synthetic"
fi

exit "${fail}"
