#!/usr/bin/env bash
# Vercel "Ignored Build Step" script.
# Exit-code convention is inverted from standard Unix:
#   0 = skip the build (no relevant files changed)
#   1 = proceed with the build

# No previous SHA → first deploy of this branch; always build.
if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]]; then
  echo "No VERCEL_GIT_PREVIOUS_SHA — forcing build."
  exit 1
fi

# Release commits change only package.json version and CHANGELOG — never rebuild.
SUBJECT=$(git log -1 --format=%s HEAD)
if [[ "$SUBJECT" == chore\(release\):* ]]; then
  echo "Release commit — skipping Vercel build."
  exit 0
fi

# Files/directories that affect the deployed site.
WATCH_PATHS=(
  app/
  components/
  lib/
  db/
  public/
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  package.json
  package-lock.json
  vercel.json
)

# Vercel shallow-clones at depth 10. If the previous SHA is outside the
# clone window, attempt a targeted fetch before falling back to a full
# unshallow. Only fail-open if the SHA is still unreachable after both
# attempts — that is a genuine last-resort, not the common path.
# Note: assumes Vercel's git remote is named "origin" (standard for Vercel builds).
if ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null; then
  echo "Previous SHA not in shallow clone — fetching."
  git fetch --depth=50 origin "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null \
    || git fetch --unshallow 2>/dev/null \
    || true
fi

if ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null; then
  echo "Previous SHA still unreachable after fetch — proceeding with build (fail-open)."
  exit 1
fi

# git diff --quiet: 0 = no diff, 1 = diff found.
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA}" HEAD -- "${WATCH_PATHS[@]}"
GIT_EXIT=$?

if [[ $GIT_EXIT -eq 0 ]]; then
  echo "No app/site files changed — skipping Vercel build."
  exit 0
else
  echo "App/site files changed — proceeding with build."
  exit 1
fi
