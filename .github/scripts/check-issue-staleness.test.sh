#!/usr/bin/env bash
# check-issue-staleness.test.sh
#
# Smoke test for .github/scripts/check-issue-staleness.sh (#1322).
#
# Stubs `gh` by prepending a fixture directory to PATH that contains a fake
# gh wrapper. The wrapper reads issue JSON from a fixture file keyed by the
# issue number passed on the command line, so each test case can supply its
# own createdAt, body, and labels without hitting the network.
#
# Cases covered:
#   1. Fresh issue (<3 days old, no git activity) -> not stale.
#   2. Old issue (>3 days old, no git activity) -> stale (age).
#   3. Recent issue (1 day old, but a tracked file was touched after filing)
#      -> stale (git activity).
#   4. Threshold configurable via STALE_THRESHOLD_DAYS env var.
#   5. stale-check:N label overrides the default threshold per-issue.
#   6. stale-check:off label disables the age check for that issue.
#   7. Invalid arguments produce a non-zero exit.
#
# Each case asserts on the STALE: line of the script's stdout.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-issue-staleness.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ ! -x "$SCRIPT_UNDER_TEST" ]]; then
  echo "FAIL: $SCRIPT_UNDER_TEST is missing or not executable" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
FIXTURE_DIR="$TMP_DIR/fixtures"
mkdir -p "$FIXTURE_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# --- gh stub --------------------------------------------------------------
# The script under test calls:
#   gh issue view <N> --json number,createdAt,body,labels
# Our stub ignores the flags and echoes the JSON at $FIXTURE_DIR/<N>.json.

STUB_BIN="$TMP_DIR/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/gh" <<EOF
#!/usr/bin/env bash
# Fake gh for tests. Only supports the 'issue view <N> --json ...' shape
# that check-issue-staleness.sh uses.
if [[ "\$1" == "issue" && "\$2" == "view" ]]; then
  num="\$3"
  fixture="$FIXTURE_DIR/\$num.json"
  if [[ -f "\$fixture" ]]; then
    cat "\$fixture"
  else
    exit 1
  fi
  exit 0
fi
echo "fake-gh: unsupported invocation: \$*" >&2
exit 1
EOF
chmod +x "$STUB_BIN/gh"

export PATH="$STUB_BIN:$PATH"

# Verify the stub takes precedence.
if [[ "$(command -v gh)" != "$STUB_BIN/gh" ]]; then
  echo "FAIL: gh stub did not win PATH precedence ($(command -v gh))" >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
FAILED_CASES=()

assert_stale() {
  local case_name="$1"
  local expected="$2"
  local output="$3"
  local actual
  actual=$(printf '%s\n' "$output" | awk -F': ' '/^STALE:/ { print $2; exit }')
  if [[ "$actual" == "$expected" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS: $case_name (STALE=$actual)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_CASES+=("$case_name (expected STALE=$expected, got STALE=$actual)")
    echo "  FAIL: $case_name (expected STALE=$expected, got STALE=$actual)"
    echo "----- script output -----"
    printf '%s\n' "$output"
    echo "-------------------------"
  fi
}

# --- Date helpers ---------------------------------------------------------
# Portable: GNU date if available, BSD date as fallback.
iso_days_ago() {
  local n="$1"
  if date -u -d "$n days ago" +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    date -u -d "$n days ago" +"%Y-%m-%dT%H:%M:%SZ"
  else
    date -u -v-"${n}"d +"%Y-%m-%dT%H:%M:%SZ"
  fi
}

# We operate from the repo root so the script's path-existence check sees
# real tracked files when a fixture references them.
cd "$REPO_ROOT"

# Pick a tracked file that's been committed within recent history to use
# for the "git activity since filing" case. README.md is always present.
ACTIVITY_FILE="README.md"
if [[ ! -f "$ACTIVITY_FILE" ]]; then
  echo "FAIL: expected $ACTIVITY_FILE to exist for git-activity test case" >&2
  exit 1
fi

echo "Running check-issue-staleness.sh smoke tests..."
echo ""

# --- Case 1: Fresh issue, no git activity --------------------------------
# 1 day old, body references no extractable file paths -> no git lookup,
# age <= threshold -> not stale.

FRESH_CREATED=$(iso_days_ago 1)
cat > "$FIXTURE_DIR/1001.json" <<EOF
{
  "number": 1001,
  "createdAt": "$FRESH_CREATED",
  "body": "A fresh issue with no code references in its body.",
  "labels": []
}
EOF

OUTPUT=$("$SCRIPT_UNDER_TEST" 1001 2>/dev/null || true)
assert_stale "fresh issue (1d old, no refs)" "no" "$OUTPUT"

# --- Case 2: Old issue, no git activity ----------------------------------
# 10 days old, no file references -> age exceeded -> stale.

OLD_CREATED=$(iso_days_ago 10)
cat > "$FIXTURE_DIR/1002.json" <<EOF
{
  "number": 1002,
  "createdAt": "$OLD_CREATED",
  "body": "An older issue with no file references.",
  "labels": []
}
EOF

OUTPUT=$("$SCRIPT_UNDER_TEST" 1002 2>/dev/null || true)
assert_stale "old issue (10d old, no refs)" "yes" "$OUTPUT"

# --- Case 3: Recent issue with git activity on referenced file -----------
# 1 day old (under default 3-day threshold), but the body references a file
# that has been touched in git history since some far-back date. We set
# createdAt 1 year ago for the git-log window but threshold via env var to
# something larger than the age, so age-check is no; only the git activity
# triggers staleness.
#
# Subtlety: to trigger only the git-activity branch we need:
#   - age <= threshold (so AGE_EXCEEDED=no)
#   - git log --since=<createdAt> finds commits touching the referenced files
# The simplest way is to set createdAt to a long-past date AND set the
# threshold higher than that age. That way age does NOT exceed, but the
# git-log lookback is wide enough to find commits.

YEAR_OLD_CREATED=$(iso_days_ago 365)
cat > "$FIXTURE_DIR/1003.json" <<EOF
{
  "number": 1003,
  "createdAt": "$YEAR_OLD_CREATED",
  "body": "Recent issue. See \`$ACTIVITY_FILE\` for the relevant surface.",
  "labels": []
}
EOF

# Threshold of 9999 days disables the age branch, so any staleness must
# come from git activity on README.md since a year ago — extremely likely
# given how active this repo is.
OUTPUT=$(STALE_THRESHOLD_DAYS=9999 "$SCRIPT_UNDER_TEST" 1003 2>/dev/null || true)
assert_stale "recent-with-activity (refs README.md, threshold=9999)" "yes" "$OUTPUT"

# --- Case 4: Threshold configurable via env var --------------------------
# 5 days old, default threshold (3) -> stale. Same issue with
# STALE_THRESHOLD_DAYS=30 -> not stale.

FIVE_DAY_CREATED=$(iso_days_ago 5)
cat > "$FIXTURE_DIR/1004.json" <<EOF
{
  "number": 1004,
  "createdAt": "$FIVE_DAY_CREATED",
  "body": "Five-day-old issue with no file references.",
  "labels": []
}
EOF

OUTPUT=$("$SCRIPT_UNDER_TEST" 1004 2>/dev/null || true)
assert_stale "5d issue at default threshold (3d)" "yes" "$OUTPUT"

OUTPUT=$(STALE_THRESHOLD_DAYS=30 "$SCRIPT_UNDER_TEST" 1004 2>/dev/null || true)
assert_stale "5d issue with STALE_THRESHOLD_DAYS=30" "no" "$OUTPUT"

# --- Case 5: stale-check:N label overrides per-issue ---------------------
# 5 days old, stale-check:30 label -> not stale. (Label beats env default.)

cat > "$FIXTURE_DIR/1005.json" <<EOF
{
  "number": 1005,
  "createdAt": "$FIVE_DAY_CREATED",
  "body": "Five-day-old issue.",
  "labels": [{"name": "stale-check:30"}]
}
EOF

OUTPUT=$("$SCRIPT_UNDER_TEST" 1005 2>/dev/null || true)
assert_stale "5d issue with stale-check:30 label" "no" "$OUTPUT"

# --- Case 6: stale-check:off label disables age check --------------------
# 10 days old, stale-check:off -> not stale (no file refs => no git
# activity either, so total verdict is not stale).

cat > "$FIXTURE_DIR/1006.json" <<EOF
{
  "number": 1006,
  "createdAt": "$OLD_CREATED",
  "body": "Old issue but flagged stale-check:off.",
  "labels": [{"name": "stale-check:off"}]
}
EOF

OUTPUT=$("$SCRIPT_UNDER_TEST" 1006 2>/dev/null || true)
assert_stale "10d issue with stale-check:off label" "no" "$OUTPUT"

# --- Case 7: Invalid argument exits non-zero -----------------------------

if "$SCRIPT_UNDER_TEST" not-a-number >/dev/null 2>&1; then
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_CASES+=("invalid arg should exit non-zero")
  echo "  FAIL: invalid arg should exit non-zero"
else
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS: invalid arg exits non-zero"
fi

echo ""
echo "Smoke tests: $PASS_COUNT passed, $FAIL_COUNT failed."

if (( FAIL_COUNT > 0 )); then
  echo ""
  echo "Failures:"
  for c in "${FAILED_CASES[@]}"; do
    echo "  - $c"
  done
  exit 1
fi

exit 0
