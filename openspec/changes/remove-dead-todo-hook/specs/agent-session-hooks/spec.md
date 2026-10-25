## Purpose

Which Claude Code hooks this repository registers in `.claude/settings.json`, and what each one
does. The baseline (current behaviour on `qa` before this change) is two `SessionStart` hooks and
one `PostToolUse` hook on `TodoWrite`; this change removes the `PostToolUse` hook, which no longer
fires and whose script has had no caller since #2003 (#1991).

## ADDED Requirements

### Requirement: Session start keeps main current and prunes stale worktrees (baseline, current behaviour)

When a Claude Code session starts in this repository, `.claude/settings.json` SHALL run, in order,
a command that fetches `origin/main` and fast-forwards the local `main` only when it is checked out
with no staged or unstaged changes (timeout 15 seconds), and `.claude/hooks/prune-worktrees.sh`
(timeout 30 seconds). Neither SHALL stop the session when it fails.

#### Scenario: Clean main is fast-forwarded

- **WHEN** a session starts on `main` with a clean working tree and `origin/main` is ahead
- **THEN** the local `main` is fast-forwarded to `origin/main` and `prune-worktrees.sh` removes any `.claude/worktrees/` entry that is unlocked and whose branch's last commit is more than 3 days old

#### Scenario: Dirty or other branch is left alone

- **WHEN** a session starts on another branch, or on `main` with uncommitted changes
- **THEN** the fetch runs but no merge happens

#### Scenario: Offline

- **WHEN** a session starts with no network
- **THEN** the fetch fails silently and the session starts normally

### Requirement: No hook mirrors the todo list to an issue comment

`.claude/settings.json` SHALL register no `PostToolUse` hook, and `.claude/hooks/` SHALL contain no
script that PATCHes an issue or PR comment from the agent's todo or task list.

#### Scenario: Task tools in a headless session

- **WHEN** a headless session (`claude -p`) uses its task tools
- **THEN** no hook runs and no GitHub API call is made

#### Scenario: TodoWrite brought back in an interactive session

- **WHEN** someone re-enables `TodoWrite` with `CLAUDE_CODE_ENABLE_TASKS=0` and the agent calls it
- **THEN** no repository hook runs

#### Scenario: The old variables are set by hand

- **WHEN** `AUTO_STATUS_COMMENT_ID`, `AUTO_STATUS_REPO` and `GH_TOKEN` are all set in the environment
- **THEN** no repository hook reads them and no comment is changed
