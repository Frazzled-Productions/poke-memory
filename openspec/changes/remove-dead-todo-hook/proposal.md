## Why

The `PostToolUse` hook on `TodoWrite` in `.claude/settings.json` and its script
`.claude/hooks/mirror-todos-to-comment.sh` are dead twice over (#1991):

1. Claude Code no longer offers `TodoWrite` (disabled by default since 2.1.142; headless 2.1.310
   offers only `Task` and `TaskStop`, whatever `CLAUDE_CODE_ENABLE_TASKS` is set to), so the
   matcher never fires.
2. Even if it fired, the script exits at its first check, because nothing sets
   `AUTO_STATUS_COMMENT_ID` any more. The only workflows that set it were deleted in #2003
   ("Remove the Claude automation", 16 August 2026), which left the hook and script behind.

The fix the issue suggests (rematch to `TaskCreate|TaskUpdate` and rewrite the payload parsing)
would restore nothing, because the comment it would update is never created. The smallest change
that fixes the bug is to delete the dead hook and script.

Fixes: poke-memory #1991

## What Changes

- Delete the `PostToolUse` block (the `TodoWrite` matcher) from `.claude/settings.json`. The
  `SessionStart` hooks and the `permissions` allow list stay byte-for-byte the same.
- Delete `.claude/hooks/mirror-todos-to-comment.sh`.
- New capability spec `agent-session-hooks`: a baseline of the `SessionStart` hooks as they are on
  `qa`, plus a requirement that no hook mirrors the todo list to an issue comment.

## Also touches

Evidence from the `blast-radius` run on 25 October 2026 against `origin/qa` at `8137a963`.

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because only `.claude/` files change; no app code, copy or route is touched.
- **Guest mode (localStorage):** no change, because no app code changes.
- **Cloud sync and Supabase migrations (both projects):** no change, because no schema, client or migration is touched.
- **Superuser mode and QA-seed scenarios:** no change, because neither reads `.claude/`.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** no change, because no app code changes.
- **Sign-in:** no change, because no app code changes.
- **Privacy notice and sub-processors:** no change, because the hook sent nothing anywhere in practice (it exited before reading its input) and no data flow is added or removed.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because `changelog-gate.yml` asks for one only when `app/**`, `components/**` or `lib/**` change, and this is internal tooling.
- **CI and GitHub Actions:** no workflow change. `git grep -E 'AUTO_STATUS_(COMMENT_ID|REPO)' -- .github` returns 0 lines, so no workflow reads or sets the variables. `auto-status.yml` (sets the project Status to Done on close) does not use the hook or the variables. `ci.yml`'s docs-only fast path does not cover `.claude/settings.json`, so full CI runs on the build PR, which is expected.
- **Claude Code sessions in this repo (not on the house list):** the `SessionStart` fetch and fast-forward and `prune-worktrees.sh` keep running; proved by deleting the block with `jq` and diffing `hooks.SessionStart` and `permissions` before and after (identical). No other file references the script: `git grep mirror-todos` finds only `.claude/settings.json` and the script itself.
- **`frazzled-claude` (the old shared plugin, same dead hook):** no change, because that repository has been archived since 17 October 2026 and its issue #6 for this bug was closed as not planned.

## Out of scope

- Reviving a live progress comment on issues or PRs. That belongs to whatever replaces the
  automation removed in #2003 and would be a new feature with its own proposal.
- A lint that fails when a hook script needs an env var no workflow sets (the report's "always-on
  signal"). See Clarifications.
- Editing `WORKFLOW.md`: #2003 already bannered its auto-status section as historical.

## Owner decisions this relies on

- 16 August 2026: remove the Claude-driven automation (#2003), which removed every setter of
  `AUTO_STATUS_COMMENT_ID`.
- 17 October 2026: `frazzled-claude` archived; shared Claude tooling lives in `~/.claude` and ops.
- 21 October 2026: every change, bug fixes included, goes through OpenSpec (`openspec/config.yaml`).

## Removes

- The `PostToolUse` / `TodoWrite` block in `.claude/settings.json` (11 lines).
- `.claude/hooks/mirror-todos-to-comment.sh` (51 lines), including its `jq` renderer for the old
  `TodoWrite` payload and its `gh api` PATCH call.
- The unwritten requirement "a hook mirrors the agent's todo list into the live auto-status
  comment", which no longer holds anywhere in the org.

## Clarifications

Open calls for Fraser's review on 25 October 2026 (overnight spend run 2026-10-25-2), each with a
recommended answer. None has an answer yet.

- 2026-10-25 Q: Delete the hook and script (this proposal), or do what the issue suggests and rematch to `TaskCreate|TaskUpdate` with new payload parsing? Recommended: delete, because the comment it would update is never created since #2003, so a rematch restores nothing. A: open.
- 2026-10-25 Q: Write a small `agent-session-hooks` spec (baseline of the `SessionStart` hooks plus "no todo mirror"), or treat this as a tooling change with no behaviour change and set `skip_specs: true`? Recommended: keep the spec, because removing a registered hook changes what the repo's hook config does (it would run if `TodoWrite` came back in an interactive session), and spec on touch asks for the baseline. A: open.
- 2026-10-25 Q: Add a lint now that fails when a `.claude/hooks/*.sh` script guards on an env var no tracked workflow sets? Recommended: no, because after this change the only hook script left (`prune-worktrees.sh`) reads no such variable, so the lint would guard nothing today. A: open.
- 2026-10-25 Q: Correct the "Fix" section of the #1991 issue body to say the matcher change alone restores nothing (it is shared GitHub state)? Recommended: yes, as a one-line note added at build time, linking this change. A: open.
