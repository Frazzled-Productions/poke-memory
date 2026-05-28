#!/usr/bin/env bash
# check-issue-staleness.sh <issue-number>
#
# Pre-implementation staleness check (#1322). Given an issue number, fetches
# the issue's createdAt + body, extracts file-path references via regex, and
# checks two staleness conditions:
#
#   1. createdAt > THRESHOLD_DAYS ago (default 3) — the codebase moves fast,
#      so an issue that has aged is suspect.
#   2. `git log --since=<createdAt>` has any commits touching files referenced
#      in the issue body — the landscape around those files has shifted since
#      the issue was filed.
#
# If either condition is true, the issue is considered stale and the caller
# (planner or /batch-issues pre-flight) should surface a confirmation prompt
# before dispatching an implementer.
#
# Output is structured key/value lines on stdout, so a caller can parse the
# verdict programmatically:
#
#   STALE: yes|no
#   ISSUE: <number>
#   CREATED_AT: <iso8601>
#   AGE_DAYS: <integer>
#   THRESHOLD_DAYS: <integer>
#   AGE_EXCEEDED: yes|no
#   REFERENCED_FILES: <space-separated paths, or empty>
#   GIT_ACTIVITY_SINCE_FILING: yes|no
#   COMMITS_TOUCHING_FILES: <integer>
#   REASONS: <semicolon-separated short reasons, or "none">
#
# A human-readable summary follows on stderr.
#
# Configurable thresholds (in precedence order):
#   1. A `stale-check:N` label on the issue (per-issue override) — N is the
#      threshold in days. Use `stale-check:off` to disable the age check for
#      this issue entirely (file-activity check still runs).
#   2. STALE_THRESHOLD_DAYS env var (run-wide override).
#   3. Hard-coded default of 3 days.
#
# Exit codes:
#   0 — script ran successfully (regardless of the staleness verdict; check
#       the `STALE:` line on stdout for the verdict).
#   1 — script failed (issue not found, gh auth missing, git missing, etc.).
#   2 — invalid arguments.
#
# Required tools: gh (authenticated), git, jq, date (GNU or BSD).
#
# Usage:
#   .github/scripts/check-issue-staleness.sh 1234
#   STALE_THRESHOLD_DAYS=7 .github/scripts/check-issue-staleness.sh 1234

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <issue-number>" >&2
  exit 2
fi

ISSUE_NUMBER="$1"

if ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "error: issue number must be a positive integer, got: $ISSUE_NUMBER" >&2
  exit 2
fi

for cmd in gh git jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command '$cmd' not found on PATH" >&2
    exit 1
  fi
done

# ---- Fetch issue ----------------------------------------------------------

ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --json number,createdAt,body,labels 2>/dev/null || true)

if [[ -z "$ISSUE_JSON" ]]; then
  echo "error: could not fetch issue #$ISSUE_NUMBER (does it exist, is gh authenticated?)" >&2
  exit 1
fi

CREATED_AT=$(echo "$ISSUE_JSON" | jq -r '.createdAt')
BODY=$(echo "$ISSUE_JSON" | jq -r '.body // ""')
LABEL_NAMES=$(echo "$ISSUE_JSON" | jq -r '.labels[].name')

# ---- Determine threshold --------------------------------------------------

# Default threshold; the project moves fast enough that 3 days is the safe
# default per #1322.
DEFAULT_THRESHOLD_DAYS=3
THRESHOLD_DAYS="${STALE_THRESHOLD_DAYS:-$DEFAULT_THRESHOLD_DAYS}"
AGE_CHECK_DISABLED="no"

# Per-issue label override: stale-check:N or stale-check:off. If both are
# applied to the same issue (operator error), stale-check:off wins because
# `AGE_CHECK_DISABLED=yes` short-circuits the age comparison below
# regardless of any THRESHOLD_DAYS value set here.
while IFS= read -r label; do
  if [[ "$label" == "stale-check:off" ]]; then
    AGE_CHECK_DISABLED="yes"
  elif [[ "$label" =~ ^stale-check:([0-9]+)$ ]]; then
    THRESHOLD_DAYS="${BASH_REMATCH[1]}"
  fi
done <<< "$LABEL_NAMES"

# ---- Compute age ----------------------------------------------------------

# Portable epoch conversion: try GNU date, fall back to BSD date.
to_epoch() {
  local ts="$1"
  if date -u -d "$ts" +%s >/dev/null 2>&1; then
    date -u -d "$ts" +%s
  else
    # BSD date wants ISO 8601 without the trailing Z; strip it.
    local stripped="${ts%Z}"
    date -u -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s
  fi
}

CREATED_EPOCH=$(to_epoch "$CREATED_AT")
NOW_EPOCH=$(date -u +%s)
AGE_SECONDS=$(( NOW_EPOCH - CREATED_EPOCH ))
AGE_DAYS=$(( AGE_SECONDS / 86400 ))

if [[ "$AGE_CHECK_DISABLED" == "yes" ]]; then
  AGE_EXCEEDED="no"
elif (( AGE_DAYS > THRESHOLD_DAYS )); then
  AGE_EXCEEDED="yes"
else
  AGE_EXCEEDED="no"
fi

# ---- Extract referenced files --------------------------------------------

# Grab backtick-quoted tokens that look like file paths with one of the
# allowed extensions. Glob-suffixed paths in issue bodies (e.g.
# `lib/sync/**`) are intentionally not matched here — `git log` accepts
# pathspecs but the path-existence check below filters them out anyway, so
# we keep the regex tight to concrete files.
EXTRACTED=$(printf '%s\n' "$BODY" \
  | grep -oE '`[a-zA-Z0-9_/.-]+\.(ts|tsx|mjs|sql|md|yml)`' \
  | sed 's/`//g' \
  | sort -u \
  || true)

# Filter to paths that exist in the current tree — broken or moved paths
# would generate noise from `git log` on the worktree-relative pathspec.
# Note: a path whose deletion since `createdAt` is itself a strong "the
# landscape has shifted" signal would be silently dropped here. Callers
# who care about that specific signal should inspect the issue body
# manually. The age-based branch still fires for sufficiently old issues
# regardless of which paths they reference.
REFERENCED_FILES=()
if [[ -n "$EXTRACTED" ]]; then
  while IFS= read -r path; do
    if [[ -n "$path" && -e "$path" ]]; then
      REFERENCED_FILES+=("$path")
    fi
  done <<< "$EXTRACTED"
fi

# ---- Check git activity since filing -------------------------------------

COMMITS_TOUCHING_FILES=0
GIT_ACTIVITY_SINCE_FILING="no"

if (( ${#REFERENCED_FILES[@]} > 0 )); then
  # git log --since accepts ISO 8601 directly.
  COMMITS_TOUCHING_FILES=$(
    git log --since="$CREATED_AT" --pretty=format:'%H' -- "${REFERENCED_FILES[@]}" 2>/dev/null \
      | grep -c . || true
  )
  if (( COMMITS_TOUCHING_FILES > 0 )); then
    GIT_ACTIVITY_SINCE_FILING="yes"
  fi
fi

# ---- Final verdict --------------------------------------------------------

REASONS=()
if [[ "$AGE_EXCEEDED" == "yes" ]]; then
  REASONS+=("age=${AGE_DAYS}d>threshold=${THRESHOLD_DAYS}d")
fi
if [[ "$GIT_ACTIVITY_SINCE_FILING" == "yes" ]]; then
  REASONS+=("git-activity=${COMMITS_TOUCHING_FILES}-commits-touching-referenced-files")
fi

if (( ${#REASONS[@]} > 0 )); then
  STALE="yes"
  REASONS_STR=$(IFS=';'; echo "${REASONS[*]}")
else
  STALE="no"
  REASONS_STR="none"
fi

# ---- Emit structured output ----------------------------------------------

echo "STALE: $STALE"
echo "ISSUE: $ISSUE_NUMBER"
echo "CREATED_AT: $CREATED_AT"
echo "AGE_DAYS: $AGE_DAYS"
echo "THRESHOLD_DAYS: $THRESHOLD_DAYS"
echo "AGE_EXCEEDED: $AGE_EXCEEDED"
if (( ${#REFERENCED_FILES[@]} > 0 )); then
  echo "REFERENCED_FILES: ${REFERENCED_FILES[*]}"
else
  echo "REFERENCED_FILES:"
fi
echo "GIT_ACTIVITY_SINCE_FILING: $GIT_ACTIVITY_SINCE_FILING"
echo "COMMITS_TOUCHING_FILES: $COMMITS_TOUCHING_FILES"
echo "REASONS: $REASONS_STR"

# Human-readable summary to stderr so callers can route it to the operator
# without parsing stdout.
{
  echo ""
  echo "Issue #$ISSUE_NUMBER staleness check:"
  echo "  Created: $CREATED_AT (${AGE_DAYS} days ago)"
  echo "  Threshold: ${THRESHOLD_DAYS} days$([ "$AGE_CHECK_DISABLED" = "yes" ] && echo " (age check disabled via stale-check:off label)")"
  if (( ${#REFERENCED_FILES[@]} > 0 )); then
    echo "  Files referenced in body (${#REFERENCED_FILES[@]}):"
    for f in "${REFERENCED_FILES[@]}"; do
      echo "    - $f"
    done
    echo "  Commits touching those files since filing: $COMMITS_TOUCHING_FILES"
  else
    echo "  Files referenced in body: (none extractable from backtick-quoted paths)"
  fi
  echo "  Verdict: STALE=$STALE  reasons=$REASONS_STR"
} >&2
