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
  vercel.ts
)

# git diff --quiet exits 0 (no diff), 1 (diff found), or 2+ (error).
# Vercel shallow-clones with --depth=10, so VERCEL_GIT_PREVIOUS_SHA may be
# outside the window and git diff will error with "bad object". Treat any
# non-zero exit as "proceed with build" (fail open).
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA}" HEAD -- "${WATCH_PATHS[@]}"
GIT_EXIT=$?

if [[ $GIT_EXIT -eq 0 ]]; then
  echo "No app/site files changed — skipping Vercel build."
  exit 0
else
  echo "App/site files changed (or git error $GIT_EXIT) — proceeding with build."
  exit 1
fi
