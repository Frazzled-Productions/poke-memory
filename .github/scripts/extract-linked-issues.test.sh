#!/usr/bin/env bash
# Smoke test for extract-linked-issues.sh. Run directly:
#   bash .github/scripts/extract-linked-issues.test.sh
# Exits 0 on all pass, non-zero (with a diff) on first failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTRACTOR="$SCRIPT_DIR/extract-linked-issues.sh"

pass=0
fail=0

assert_eq() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass=$((pass + 1))
    echo "PASS  $name"
  else
    fail=$((fail + 1))
    echo "FAIL  $name"
    echo "  expected: $(printf %q "$expected")"
    echo "  actual:   $(printf %q "$actual")"
  fi
}

# 1. closes #123 in PR body → 123
out=$(PR_BODY="This PR closes #123 and improves things." BRANCH="" GIT_LOG="" bash "$EXTRACTOR")
assert_eq "pr-body closes #123" "123" "$out"

# 2. auto/issue-456-foo branch → 456
out=$(PR_BODY="" BRANCH="auto/issue-456-foo" GIT_LOG="" bash "$EXTRACTOR")
assert_eq "branch auto/issue-456 → 456" "456" "$out"

# 3. Fixes #789 in commit message → 789
out=$(PR_BODY="" BRANCH="" GIT_LOG=$'Some commit subject\n\nFixes #789' bash "$EXTRACTOR")
assert_eq "commit Fixes #789 → 789" "789" "$out"

# 4. All three present, all different → 123 456 789 (sorted, newline-separated)
out=$(PR_BODY="closes #123" BRANCH="fix/456-bar" GIT_LOG="resolves #789" bash "$EXTRACTOR")
assert_eq "three distinct sources sorted" $'123\n456\n789' "$out"

# 5. All three present, same number → 123 (deduped)
out=$(PR_BODY="closes #123" BRANCH="auto/issue-123-foo" GIT_LOG="fixes #123" bash "$EXTRACTOR")
assert_eq "same number across sources deduped" "123" "$out"

# 6. None present → empty
out=$(PR_BODY="A change with no issue link." BRANCH="worktree-abc" GIT_LOG="No closes here." bash "$EXTRACTOR")
assert_eq "no matches → empty" "" "$out"

echo
echo "Summary: $pass passed, $fail failed"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
