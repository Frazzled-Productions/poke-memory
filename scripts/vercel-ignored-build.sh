#!/usr/bin/env bash
# Vercel "Ignored Build Step" script, wired in via vercel.json `ignoreCommand`.
# Exit-code convention is inverted from standard Unix:
#   0 = skip the build (only non-build files changed)
#   1 = proceed with the build
#
# Tests: scripts/vercel-ignored-build.test.mjs runs this script against
# throwaway git repos.

# No previous SHA: first deploy of this branch; always build.
if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]]; then
  echo "No VERCEL_GIT_PREVIOUS_SHA - forcing build."
  exit 1
fi

# SKIP-LIST, not an allow-list (#2017). A commit skips the build only when
# EVERY changed path is listed here as known not to affect the deployed site;
# anything else, including a path added in future, builds.
#
# The previous allow-list (WATCH_PATHS) failed silently: messages/, i18n/ and
# the root instrumentation*.ts files were build inputs that arrived after the
# list was written, so a copy-only or Sentry-config-only change would have
# merged green and never reached production. A skip-list fails the other way:
# a forgotten entry here costs one unnecessary build, never a missed deploy.
#
# Entries are anchored at the repo root. Keep them to paths that are provably
# not read by `next build` or at runtime. In particular, do NOT add *.md as a
# glob: CHANGELOG.md is read by /whats-new at render time (next.config.ts
# outputFileTracingIncludes), so a changelog-only correction must deploy.
SKIP_PATHS=(
  # Documentation and agent/process instructions.
  docs/
  README.md
  AGENTS.md
  CLAUDE.md
  WORKFLOW.md
  SECURITY.md
  LICENSE
  .claude/
  # Changelog fragments: assembled into CHANGELOG.md by the release job, which
  # also bumps package.json, so the release commit itself builds.
  changelog.d/
  # CI configuration and CI-only tooling.
  .github/
  # Test-only code and config. tsconfig.json includes **/*.ts, so `next build`
  # type-checks these, but they never change the build output; CI's typecheck
  # job is the gate for type errors in them.
  e2e/
  playwright.config.ts
  vitest.config.ts
  vitest.setup.ts
  vitest.setup.node.ts
  coverage-floor.json
  # Offline art-generation tooling (Python), not imported by the app.
  tools/
  # Example env file for local setup; Vercel reads env vars from the project.
  .env.local.example
)

# Build the pathspec: everything from the repo root, minus the skip-list.
PATHSPEC=(":/")
for p in "${SKIP_PATHS[@]}"; do
  PATHSPEC+=(":(top,exclude)${p}")
done

# Vercel shallow-clones at depth 10. If the previous SHA is outside the
# clone window, attempt a targeted fetch before falling back to a full
# unshallow. Only fail-open if the SHA is still unreachable after both
# attempts - that is a genuine last resort, not the common path.
# Note: assumes Vercel's git remote is named "origin" (standard for Vercel builds).
if ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null; then
  echo "Previous SHA not in shallow clone - fetching."
  git fetch --depth=50 origin "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null \
    || git fetch --unshallow 2>/dev/null \
    || true
fi

if ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}" 2>/dev/null; then
  echo "Previous SHA still unreachable after fetch - proceeding with build (fail-open)."
  exit 1
fi

# git diff --quiet: 0 = no diff, 1 = diff found, anything else = error.
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA}" HEAD -- "${PATHSPEC[@]}"
GIT_EXIT=$?

if [[ $GIT_EXIT -eq 0 ]]; then
  echo "Only non-build files changed (docs, CI, tests, tooling) - skipping Vercel build."
  exit 0
elif [[ $GIT_EXIT -eq 1 ]]; then
  echo "Build-relevant files changed - proceeding with build."
  exit 1
else
  echo "git diff failed (exit ${GIT_EXIT}) - proceeding with build (fail-open)."
  exit 1
fi
