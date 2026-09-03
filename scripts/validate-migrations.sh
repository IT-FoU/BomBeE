#!/usr/bin/env bash
# Milestone 0: migration framework placeholder.
# Milestone 1+ will add real SQL migrations under supabase/migrations.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="${ROOT_DIR}/supabase/migrations"

if [[ ! -d "${MIG_DIR}" ]]; then
  echo "ERROR: missing ${MIG_DIR}"
  exit 1
fi

# Allow empty dir in Milestone 0, but require README and naming convention doc.
if [[ ! -f "${MIG_DIR}/README.md" ]]; then
  echo "ERROR: missing ${MIG_DIR}/README.md"
  exit 1
fi

shopt -s nullglob
files=("${MIG_DIR}"/*.sql)
for file in "${files[@]}"; do
  base="$(basename "${file}")"
  if [[ ! "${base}" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "ERROR: invalid migration name: ${base}"
    echo "Expected: YYYYMMDDHHMMSS_description.sql"
    exit 1
  fi
done

echo "Migration validation OK (${#files[@]} SQL files)"
