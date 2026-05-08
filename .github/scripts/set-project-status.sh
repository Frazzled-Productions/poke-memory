#!/usr/bin/env bash
# set-project-status.sh <issue-or-pr-number> <status-name>
#
# Sets the Status field on the Poké Memory roadmap project for the given
# issue or PR. Idempotent: if the item isn't on the project yet, it gets
# added; if it is, the existing item is reused.
#
# Status names: Todo | Planned | In Progress | PR | Ready to merge | Done
#
# Required env:
#   GH_TOKEN  — must carry `project` scope (default GITHUB_TOKEN does not for
#               user-owned projects). Use a PAT secret like PROJECTS_TOKEN.
#   GITHUB_REPOSITORY (set by Actions automatically)

set -euo pipefail

NUMBER="${1:?issue or PR number required}"
STATUS_NAME="${2:?status name required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set (owner/repo)}"

PROJECT_ID="PVT_kwHOAsv3zc4BXGBo"
STATUS_FIELD_ID="PVTSSF_lAHOAsv3zc4BXGBozhSVUac"

case "$STATUS_NAME" in
  "Todo")           OPTION_ID="f75ad846" ;;
  "Planned")        OPTION_ID="caff8240" ;;
  "In Progress")    OPTION_ID="47fc9ee4" ;;
  "PR")             OPTION_ID="927aaab7" ;;
  "Ready to merge") OPTION_ID="00d0a95b" ;;
  "Done")           OPTION_ID="98236657" ;;
  *) echo "Unknown status: $STATUS_NAME" >&2; exit 1 ;;
esac

# /issues/{N} works for both issues and PRs (PRs are issues in REST).
# `node_id` is the GraphQL Relay ID — same value GraphQL would return.
NODE_ID=$(gh api "/repos/$GITHUB_REPOSITORY/issues/$NUMBER" --jq '.node_id')

if [[ -z "$NODE_ID" || "$NODE_ID" == "null" ]]; then
  echo "Could not resolve node ID for #$NUMBER in $GITHUB_REPOSITORY" >&2
  exit 1
fi

ITEM_ID=$(gh api graphql \
  -f query='
    mutation($project:ID!, $content:ID!) {
      addProjectV2ItemById(input:{projectId:$project, contentId:$content}) {
        item { id }
      }
    }' \
  -F project="$PROJECT_ID" -F content="$NODE_ID" \
  --jq '.data.addProjectV2ItemById.item.id')

if [[ -z "$ITEM_ID" || "$ITEM_ID" == "null" ]]; then
  echo "Could not add or find project item for node $NODE_ID" >&2
  exit 1
fi

gh api graphql \
  -f query='
    mutation($project:ID!, $item:ID!, $field:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input:{
        projectId:$project,
        itemId:$item,
        fieldId:$field,
        value:{ singleSelectOptionId:$value }
      }) {
        projectV2Item { id }
      }
    }' \
  -F project="$PROJECT_ID" -F item="$ITEM_ID" -F field="$STATUS_FIELD_ID" -F value="$OPTION_ID" \
  --jq 'if .errors then error("graphql errors: " + (.errors | tostring)) else .data.updateProjectV2ItemFieldValue.projectV2Item.id end' \
  >/dev/null

echo "Set #$NUMBER → $STATUS_NAME"
