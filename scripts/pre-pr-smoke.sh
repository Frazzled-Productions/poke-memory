#!/usr/bin/env bash
# Pre-PR e2e smoke (#1126).
#
# Chromium-only Playwright smoke subset, run via the pinned Docker image so
# the agent and CI use the same Node/browser combo. Intended for PRs that
# touch high-surface-area files (see AGENTS.md "Pre-PR e2e smoke") where the
# unit suite cannot see the regression class — typically a global element
# like an onboarding modal or nav component that affects every page.
#
# Usage:
#   ./scripts/pre-pr-smoke.sh
#
# Prerequisites:
#   - Docker installed and running.
#   - Working tree at the commit you intend to push (the container runs
#     `npm ci && npm run build` against the current checkout).
#
# Exit codes:
#   0   all specs passed.
#   non-zero  one or more specs failed, or Docker is unavailable.
#
# The smoke subset is deliberately narrow — see AGENTS.md for the rationale.
# CI still runs the full chromium + mobile-safari matrix authoritatively.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required but not installed" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "error: docker is installed but the daemon is not reachable" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running pre-PR e2e smoke (chromium) in pinned Playwright image..."
echo "Working directory: ${REPO_ROOT}"

docker run --rm \
  -v "${REPO_ROOT}":/work \
  -w /work \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  bash -c "npm ci && npm run build && (npm start &) && npx wait-on --timeout 60000 http://localhost:3000 && npx playwright test --project=chromium e2e/smoke.spec.ts e2e/onboarding.spec.ts e2e/practice-scope.spec.ts e2e/pasture.spec.ts"
