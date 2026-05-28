#!/usr/bin/env bash
# Extract linked issue numbers (closes/fixes/resolves #N, case-insensitive) from
# three sources: PR body, branch name, and the git log of the PR's commits. The
# deduplicated, sorted list is printed to stdout, one number per line.
#
# Inputs are passed as environment variables so callers don't have to quote
# multi-line strings on the command line:
#   PR_BODY  — the PR description (may be empty)
#   BRANCH   — the head branch name (e.g. `auto/issue-1234-foo`, `fix/1259-bar`)
#   GIT_LOG  — the output of `git log <base>..HEAD --format=%B` (may be empty)
#
# Branch-name parsing covers both the `closes/fixes/resolves #N` shape (rare in
# branch names but supported for symmetry) and the project's branch
# conventions: `auto/issue-N-...`, `fix/N-...`, `feat/N-...`, and any other
# `<prefix>/<N>-<slug>` shape where the leading segment after the first slash
# is a bare integer.
#
# Empty inputs are tolerated. When all three sources yield nothing, the script
# exits 0 with no output — callers detect "no linked issue" via empty stdout.

set -euo pipefail

PR_BODY="${PR_BODY:-}"
BRANCH="${BRANCH:-}"
GIT_LOG="${GIT_LOG:-}"

# Collect candidate issue numbers into a single newline-separated stream, then
# sort -u at the end. Each extractor prints `<N>\n` per match and nothing on no
# match.

extract_keywords() {
  # closes/fixes/resolves #N, case-insensitive, anywhere in the input.
  printf '%s\n' "$1" | grep -ioE '(closes|fixes|resolves)[[:space:]]+#[0-9]+' \
    | grep -oE '[0-9]+' || true
}

extract_branch_issue() {
  # `auto/issue-1234-...`, `fix/1259-...`, `feat/789-...`, etc.
  printf '%s\n' "$1" | grep -oE '^[a-zA-Z][a-zA-Z0-9_-]*/(issue-)?[0-9]+' \
    | grep -oE '[0-9]+$' || true
  # Also catch `closes/fixes/resolves #N` if present in the branch name.
  extract_keywords "$1"
}

{
  extract_keywords "$PR_BODY"
  extract_branch_issue "$BRANCH"
  extract_keywords "$GIT_LOG"
} | { grep -E '^[0-9]+$' || true; } | sort -un
