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
# A new push-to-main producer must call this too. Without it, qa silently
# drifts behind main and the daily qa-drift-check opens a tracking issue
# (#1959, #1989, #2044).
#
# Behaviour:
#   * main already an ancestor of qa: no-op (exit 0).
#   * otherwise: merge (never reset) origin/main into origin/qa with --no-ff,
#     so un-promoted batch work on qa is preserved, and push to qa.
#   * a merge conflict fails loudly (exit 1) with a ::error:: annotation that
#     names the conflicting files; qa is left untouched for a human.
#   * a merge that would change .github/workflows/** on qa fails fast (exit 1)
#     WITHOUT pushing: the poke-memory-bot App has no `workflows` permission,
#     and GitHub refuses a workflow-file update pushed with an App token that
#     lacks it. A push that is refused for that reason anyway is caught from
#     git's stderr and also fails without a retry. Set
#     BACKMERGE_ALLOW_WORKFLOW_CHANGES=1 only once the App has been granted
#     `workflows: write`.
#   * a push rejected as non-fast-forward (qa moved underneath us: a PR merged
#     into qa mid-run) is retried from a fresh fetch after a short backoff, up
#     to MAX_ATTEMPTS times. Any other rejection fails at once.
#   * the caller's original HEAD (branch or commit) is restored on exit.
#
# Auth: the caller's checkout must hold the poke-memory-bot App installation
# token (actions/checkout `token:`), because the App is the bypass actor on the
# `qa-staging` ruleset (required status checks). A git identity must already be
# configured.
#
# Tests: scripts/backmerge-main-into-qa.test.mjs (runs this script against
# throwaway git repos; part of `npm test`).

set -euo pipefail

MSG="${1:?usage: backmerge-main-into-qa.sh \"<merge commit message>\"}"
MAX_ATTEMPTS="${BACKMERGE_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${BACKMERGE_RETRY_DELAY:-5}"
ALLOW_WORKFLOW_CHANGES="${BACKMERGE_ALLOW_WORKFLOW_CHANGES:-0}"

MANUAL_FIX="A maintainer runs the merge locally and pushes it (git fetch origin && git checkout -B qa origin/qa && git merge --no-ff origin/main && git push origin qa)"

ORIG_HEAD=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)
restore_head() {
  git merge --abort >/dev/null 2>&1 || true
  git checkout --quiet "$ORIG_HEAD" >/dev/null 2>&1 || true
}
trap restore_head EXIT

# A merge needs the common ancestor; a depth-1 checkout does not have it.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --quiet --unshallow origin
fi

workflow_permission_error() {
  echo "::error::The main -> qa backmerge changes GitHub Actions workflow files ($1), and the poke-memory-bot App token has no \`workflows\` permission, so GitHub will refuse the push to qa. Nothing was pushed; qa is now behind main. Fix: ${MANUAL_FIX}, or grant the App \`workflows: write\` and set BACKMERGE_ALLOW_WORKFLOW_CHANGES=1. The daily qa-drift-check issue will track it until then."
}

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
    echo "::error::Backmerge of main ($(git rev-parse --short origin/main)) into qa ($(git rev-parse --short origin/qa)) hit a merge conflict in: ${CONFLICTS:-unknown files}. qa is untouched and now behind main. ${MANUAL_FIX}, resolving the conflict. The daily qa-drift-check issue will track it until then."
    exit 1
  fi

  # The ref update qa -> merge commit is what GitHub checks, so compare trees.
  WORKFLOW_CHANGES=$(git diff --name-only origin/qa HEAD -- .github/workflows | tr '\n' ' ')
  if [ -n "$WORKFLOW_CHANGES" ] && [ "$ALLOW_WORKFLOW_CHANGES" != "1" ]; then
    workflow_permission_error "${WORKFLOW_CHANGES% }"
    exit 1
  fi

  PUSH_ERR=$(mktemp)
  if git push origin "HEAD:refs/heads/qa" 2>"$PUSH_ERR"; then
    cat "$PUSH_ERR" >&2
    rm -f "$PUSH_ERR"
    echo "Merged main ($(git rev-parse --short origin/main)) into qa: $(git rev-parse --short HEAD)."
    exit 0
  fi
  cat "$PUSH_ERR" >&2
  PUSH_STDERR=$(cat "$PUSH_ERR")
  rm -f "$PUSH_ERR"

  if grep -qi "refusing to allow a GitHub App to create or update workflow" <<<"$PUSH_STDERR"; then
    workflow_permission_error "${WORKFLOW_CHANGES:-see the push error above}"
    exit 1
  fi

  if ! grep -Eq "\((fetch first|non-fast-forward)\)" <<<"$PUSH_STDERR"; then
    echo "::error::Pushing the main -> qa backmerge was rejected (see the error above), and not because qa moved, so it is not retried. If it is a protected-branch rejection, the checkout is not using the poke-memory-bot App token (the qa-staging bypass actor). qa is now behind main; the daily qa-drift-check issue will track it."
    exit 1
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::Pushing the main -> qa backmerge was rejected as non-fast-forward ${attempt} times (qa kept moving). qa is now behind main; re-run this workflow, or ${MANUAL_FIX}."
    exit 1
  fi
  echo "Push to qa rejected as non-fast-forward (attempt ${attempt}/${MAX_ATTEMPTS}); qa moved. Retrying from a fresh fetch in ${RETRY_DELAY}s."
  sleep "$RETRY_DELAY"
  attempt=$((attempt + 1))
done
