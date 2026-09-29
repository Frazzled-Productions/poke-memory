#!/usr/bin/env bash
#
# Merge origin/main into origin/qa so qa never falls behind main (#2058).
#
# Usage: backmerge-main-into-qa.sh "<merge commit message>"
#
# Every workflow path that lands a commit on `main` without the `qa -> main`
# promotion's "Reset qa to main" step behind it calls this straight after its
# push to `main`:
#   * auto-release.yml `backmerge-hotfix` job (a hotfix or Dependabot PR merged
#     into main)
#   * auto-release.yml `release` job on the schedule / workflow_dispatch path
#     (the `chore(release)` commit)
#   * refresh-user-count.yml (the daily `chore(stats)` commit)
# Without it, qa silently drifts behind main and the daily qa-drift-check opens
# a tracking issue (#1959, #1989, #2044).
#
# Behaviour:
#   * main already an ancestor of qa: no-op (exit 0).
#   * otherwise: merge (never reset) origin/main into origin/qa with --no-ff,
#     so un-promoted batch work on qa is preserved, and push to qa.
#   * a merge conflict fails loudly (exit 1) with a ::error:: annotation that
#     names the conflicting files; qa is left untouched for a human.
#   * a push rejected because qa moved underneath us (a PR merged into qa
#     mid-run) is retried from a fresh fetch, up to MAX_ATTEMPTS times.
#
# Auth: the caller's checkout must hold the poke-memory-bot App installation
# token (actions/checkout `token:`), because the App is the bypass actor on the
# `qa-staging` ruleset (required status checks). A git identity must already be
# configured. The caller's working tree is left on a detached qa merge commit,
# so call this as the LAST git operation in a job.
#
# Tests: scripts/backmerge-main-into-qa.test.mjs (runs this script against
# throwaway git repos; part of `npm test`).

set -euo pipefail

MSG="${1:?usage: backmerge-main-into-qa.sh \"<merge commit message>\"}"
MAX_ATTEMPTS="${BACKMERGE_MAX_ATTEMPTS:-3}"

# A merge needs the common ancestor; a depth-1 checkout does not have it.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --quiet --unshallow origin
fi

attempt=1
while :; do
  # Explicit refspecs: a single-branch clone (`--depth 1 --branch main`) has
  # no refs/remotes/origin/qa mapping, so a bare `git fetch origin main qa`
  # would leave origin/qa missing or stale.
  git fetch --quiet origin \
    "+refs/heads/main:refs/remotes/origin/main" \
    "+refs/heads/qa:refs/remotes/origin/qa"

  if git merge-base --is-ancestor origin/main origin/qa; then
    echo "qa already contains main ($(git rev-parse --short origin/main)); nothing to backmerge."
    exit 0
  fi

  git checkout --quiet --detach origin/qa
  if ! git merge --no-ff --no-edit -m "$MSG" origin/main; then
    CONFLICTS=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
    git merge --abort || true
    echo "::error::Backmerge of main ($(git rev-parse --short origin/main)) into qa ($(git rev-parse --short origin/qa)) hit a merge conflict in: ${CONFLICTS:-unknown files}. qa is untouched and now behind main; merge main into qa by hand (git checkout qa && git merge --no-ff origin/main) and push. The daily qa-drift-check issue will track it until then."
    exit 1
  fi

  if git push origin "HEAD:refs/heads/qa"; then
    echo "Merged main ($(git rev-parse --short origin/main)) into qa: $(git rev-parse --short HEAD)."
    exit 0
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::Pushing the main -> qa backmerge failed ${attempt} times. If the error above is a protected-branch rejection, the checkout is not using the poke-memory-bot App token (the qa-staging bypass actor). qa is now behind main; the daily qa-drift-check issue will track it."
    exit 1
  fi
  echo "Push to qa rejected (attempt ${attempt}/${MAX_ATTEMPTS}); qa may have moved. Re-fetching and retrying."
  attempt=$((attempt + 1))
done
