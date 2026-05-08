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
#   GH_TOKEN       — org-scoped installation token (App installed on
#                    Frazzled-Productions, with Org Projects: write).
#                    Used for the GraphQL project mutations.
#   GH_TOKEN_REPO  — repo-scoped installation token (App installed on the
#                    repo's owner). Used for the REST node-ID lookup of
#                    the issue/PR. Required because the org-scoped token
#                    can't see issues in a user-owned repo.
#   GITHUB_REPOSITORY (set by Actions automatically)

set -euo pipefail

NUMBER="${1:?issue or PR number required}"
STATUS_NAME="${2:?status name required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set (owner/repo)}"
: "${GH_TOKEN:?GH_TOKEN must be set (org-scoped App token)}"
: "${GH_TOKEN_REPO:?GH_TOKEN_REPO must be set (repo-scoped App token)}"

PROJECT_ID="PVT_kwDOEN1Tuc4BXHrG"
STATUS_FIELD_ID="PVTSSF_lADOEN1Tuc4BXHrGzhSWyi0"

case "$STATUS_NAME" in
  "Todo")           OPTION_ID="f75ad846" ;;
  "Planned")        OPTION_ID="3ef076f8" ;;
  "In Progress")    OPTION_ID="47fc9ee4" ;;
  "PR")             OPTION_ID="53f585e0" ;;
  "Ready to merge") OPTION_ID="eefa8005" ;;
  "Done")           OPTION_ID="98236657" ;;
  *) echo "Unknown status: $STATUS_NAME" >&2; exit 1 ;;
esac

# /issues/{N} works for both issues and PRs (PRs are issues in REST).
# `node_id` is the GraphQL Relay ID — same value GraphQL would return.
# Use the repo-scoped token here; the org-scoped one can't see this repo.
NODE_ID=$(GH_TOKEN="$GH_TOKEN_REPO" gh api "/repos/$GITHUB_REPOSITORY/issues/$NUMBER" --jq '.node_id')

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
  -f project="$PROJECT_ID" -f content="$NODE_ID" \
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
  -f project="$PROJECT_ID" -f item="$ITEM_ID" -f field="$STATUS_FIELD_ID" -f value="$OPTION_ID" \
  --jq 'if .errors then error("graphql errors: " + (.errors | tostring)) else .data.updateProjectV2ItemFieldValue.projectV2Item.id end' \
  >/dev/null

echo "Set #$NUMBER → $STATUS_NAME"
