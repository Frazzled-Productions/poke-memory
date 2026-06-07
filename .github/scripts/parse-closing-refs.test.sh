#!/usr/bin/env bash
# Smoke test for parse-closing-refs.sh. Run directly:
#   bash .github/scripts/parse-closing-refs.test.sh
# Exits 0 on all pass, non-zero (with a diff) on first failure.
#
# Forcing function for #1763: the regression that shipped during the 0.11.0
# batch was "closes #A #B #C labels only #A". T1 below pins all three.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$SCRIPT_DIR/parse-closing-refs.sh"

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

run() { printf '%s' "$1" | bash "$PARSER" | tr '\n' ' ' | sed 's/ $//'; }

# 1. THE #1763 REGRESSION: one keyword, a space-separated run of #N → all of them.
out=$(run 'closes #1720 #1721 #1722 #1723 #1724 #1725 #1726')
assert_eq "multi-issue space-separated run (#1763 gap 1)" "1720 1721 1722 1723 1724 1725 1726" "$out"

# 2. The Layout epic shape that got NONE: keyword + run.
out=$(run 'closes #1729 #1730 #1731 #1732 #1733 #1734 #1735')
assert_eq "layout epic run" "1729 1730 1731 1732 1733 1734 1735" "$out"

# 3. Many keywords across lines, one #N each (GitHub's canonical form).
out=$(run $'closes #10\nfixes #11\nresolves #12')
assert_eq "one keyword per #N across lines" "10 11 12" "$out"

# 4. Commas and the word "and" as separators in a single run.
out=$(run 'This PR closes #1, #2 and #3.')
assert_eq "comma + and separators" "1 2 3" "$out"

# 5. Bare #N with no keyword must NOT match (e.g. a trailing `Refs #...` line).
out=$(run $'Layout epic. closes #1729 #1730\n\nRefs #1714, #806')
assert_eq "bare Refs line ignored" "1729 1730" "$out"

# 6. Optional colon and case-insensitivity.
out=$(run $'CLOSES: #5\nResolved #6')
assert_eq "colon + mixed case" "5 6" "$out"

# 7. Keyword embedded in a longer word must NOT match (word boundary).
out=$(run 'preclose #99 prefixes #98 should not count')
assert_eq "embedded keyword not matched" "" "$out"

# 8. Dedup + ascending sort across body and commit lines.
out=$(run $'closes #30 #10\nfixes #10\nresolves #20')
assert_eq "dedup + sort" "10 20 30" "$out"

# 9. A run does NOT bleed across a newline into a following bare #N.
out=$(run $'closes #5\n#806 is just a mention')
assert_eq "run does not cross newline into bare #N" "5" "$out"

# 10. Empty input → empty output.
out=$(run '')
assert_eq "empty input → empty" "" "$out"

# 11. No closing reference at all → empty.
out=$(run 'A refactor with no linked issue.')
assert_eq "no closing reference → empty" "" "$out"

echo
echo "Summary: $pass passed, $fail failed"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
