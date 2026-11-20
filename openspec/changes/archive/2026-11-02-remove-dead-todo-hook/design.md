## Context

`.claude/settings.json` registers three hooks on `qa`: two `SessionStart` commands (fetch and
fast-forward `main`, then `prune-worktrees.sh`) and one `PostToolUse` command on the `TodoWrite`
matcher (`mirror-todos-to-comment.sh`). The last one was added in `6b192d00` to PATCH a live
"Working on this" comment that the Claude-driven CI workflows created and passed in through
`AUTO_STATUS_COMMENT_ID`, `AUTO_STATUS_REPO` and `GH_TOKEN`.

## Root cause

From the root-cause report of 25 October 2026 (overnight spend run 2026-10-25-2, against
`origin/qa`, Claude Code 2.1.310).

**Verdict.** The hook is dead twice over, and the second reason is the decisive one. The issue's
diagnosis (the matcher names a tool that no longer exists) is right but incomplete: even with a
working matcher, the script exits at its first line, because nothing in the org sets
`AUTO_STATUS_COMMENT_ID` any more.

**Surviving mechanism.** The feature had two halves: a CI workflow that created the status comment
and exported its id, and a local hook that PATCHed it on each todo update. #2003 deleted the first
half and left the second. Separately, the Claude Code tool rename removed the event the hook
listened for. Either alone kills the feature; fixing only the matcher leaves the first in place.

**First wrong step.** `9420abda` (#2003, 16 August 2026) removed every producer of
`AUTO_STATUS_COMMENT_ID` without removing its only consumer: `.claude/settings.json:3-13` (the
`PostToolUse` block) and `.claude/hooks/mirror-todos-to-comment.sh`. The script's header comment
("set by the workflow before the Claude action runs") names a workflow that no longer exists.

**Evidence.**

| Hypothesis | Result | Evidence |
|---|---|---|
| H1: matcher names a disabled tool (the issue's claim) | Holds, but not sufficient | Seen: headless 2.1.310 offers no `TodoWrite`. |
| H2: `CLAUDE_CODE_ENABLE_TASKS=0` brings `TodoWrite` back, so an alternate matcher is a useful fallback | Refuted for headless 2.1.310 | Seen: tool list identical (`Task`, `TaskStop`) with the variable unset, `0` and `1`. |
| H3: the script would work once the matcher fires | Refuted | Seen: the script exits 0 at its env guard. Cited: 0 setters of `AUTO_STATUS_(COMMENT_ID\|REPO)` under `.github` on `origin/qa`; org code search finds only the script. |
| H4: the hook failed while CI still ran (before #2003) | Unknown | The July 2026 run logs have expired (HTTP 410). |

Unknown and accepted: interactive-mode tool list was not probed. It does not change the fix,
because H3 alone makes the hook a no-op in every mode.

## Goals / Non-Goals

**Goals:** remove the dead hook registration and script; leave every other hook and permission
exactly as it is.

**Non-Goals:** reviving a live progress comment; a lint for unset hook variables; touching the
archived `frazzled-claude` repository.

## Decisions

- **Delete rather than rematch.** A rematch to `TaskCreate|TaskUpdate` plus new payload parsing
  would still exit at the env guard, because no workflow creates the comment. Deleting is the only
  change that makes the config tell the truth. Alternative considered and rejected: keep the script
  "for later". It names a workflow that no longer exists and would mislead the next reader.
- **Edit `settings.json` by removing the one key.** The `PostToolUse` key holds only this entry, so
  the whole key goes. `hooks.SessionStart` and `permissions` must be identical before and after;
  the build checks that with `jq` rather than by eye.

## Risks / Trade-offs

- A local `settings.local.json` that someone wrote to extend the `PostToolUse` list would merge
  differently. Likelihood nil today: no `.claude/settings.local.json` is tracked in this repository.
- Anyone who wants the progress comment back has to rebuild both halves. That is the honest cost;
  the current code gives the impression it works when it does not.
