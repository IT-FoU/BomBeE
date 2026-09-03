#!/usr/bin/env bash
# Create an annotated release-candidate tag locally.
# Does NOT push Production. Does NOT deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/tag-release-candidate.sh <semver>"
  echo "Example: bash scripts/tag-release-candidate.sh 0.12.0"
  exit 1
fi

TAG="rc-v${VERSION}"
MSG="Release candidate ${TAG} — Staging/Private Beta only. PRODUCTION HOLD."

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists"
  git show "$TAG" --no-patch --pretty=fuller
  exit 0
fi

git tag -a "$TAG" -m "$MSG"
echo "Created local tag $TAG"
echo "Push when ready: git push origin $TAG"
echo "PRODUCTION HOLD remains — do not deploy Production from this tag without written Owner order."
