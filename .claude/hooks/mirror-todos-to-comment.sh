#!/usr/bin/env bash
# PostToolUse hook for the TodoWrite tool. Renders the new todo list as a
# markdown checklist and PATCHes the live auto-status comment so the issue or
# PR timeline reflects Claude's progress in real time.
#
# Required env (set by the workflow before the Claude action runs):
#   AUTO_STATUS_COMMENT_ID — comment ID to PATCH
#   AUTO_STATUS_REPO       — owner/repo
#   GH_TOKEN               — installation token with issues:write
#
# When any of those are missing (e.g. running locally outside CI) the hook
# is a no-op so it's safe to leave registered.

set -euo pipefail

if [[ -z "${AUTO_STATUS_COMMENT_ID:-}" \
   || -z "${AUTO_STATUS_REPO:-}" \
   || -z "${GH_TOKEN:-}" ]]; then
  exit 0
fi

INPUT=$(cat)

BODY=$(printf '%s' "$INPUT" | jq -r '
  def render_item:
    # Older Claude Code TodoWrite payloads omit `activeForm`; fall back
    # to `content` so in-progress lines never render blank.
    (.activeForm // .content) as $label
    | if .status == "completed" then
        "- [x] " + .content
      elif .status == "in_progress" then
        "- [ ] **" + $label + "** _(in progress)_"
      else
        "- [ ] " + .content
      end;

  "<!-- auto-status -->\n## Working on this\n\n" +
  ((.tool_input.todos // []) | map(render_item) | join("\n"))
')

TMP=$(mktemp)
printf '%s\n' "$BODY" > "$TMP"

# Suppress only the success-response stdout; let stderr surface in the
# Actions log so failures aren't silent.
gh api -X PATCH "/repos/$AUTO_STATUS_REPO/issues/comments/$AUTO_STATUS_COMMENT_ID" \
  -F "body=@$TMP" >/dev/null || true

rm -f "$TMP"
