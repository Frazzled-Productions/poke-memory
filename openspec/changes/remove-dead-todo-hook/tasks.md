## 1. Failing check first

- [x] 1.1 Before any edit, run `jq -e '.hooks.PostToolUse == null' .claude/settings.json && test ! -e .claude/hooks/mirror-todos-to-comment.sh` and record that it exits non-zero (red: the block and script exist). Verify: exit code pasted in the PR. Done (spike): exit=1 on the proposal branch before any edit (`jq` printed `false`).

## 2. Remove the dead hook

- [x] 2.1 Delete the `PostToolUse` key from `.claude/settings.json` (requirement "No hook mirrors the todo list to an issue comment"). Verify: the 1.1 check now exits 0. Done (spike): 1.1 check exit=0 after the edit.
- [x] 2.2 Delete `.claude/hooks/mirror-todos-to-comment.sh` (same requirement). Verify: the 1.1 check exits 0 and `git grep -n mirror-todos` returns nothing. Done (spike): 1.1 check exit=0; `git grep -n mirror-todos -- ':!openspec/changes/remove-dead-todo-hook'` exit=1 (only this change's own docs name it).
- [x] 2.3 Keep the session-start hooks and permissions unchanged (requirement "Session start keeps main current and prunes stale worktrees"). Verify: `diff <(git show origin/qa:.claude/settings.json | jq -S '.hooks.SessionStart,.permissions') <(jq -S '.hooks.SessionStart,.permissions' .claude/settings.json)` prints nothing, and a fresh `claude` session in the worktree starts with no hook error. Done (spike): the `diff` printed nothing (exit 0); headless `claude -p` in the worktree exited 0 with every `SessionStart` hook `outcome: success`.

## 3. Gates

- [x] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0. Verify: exit code pasted in the PR. Done (spike): exit 0, 2 passed, 0 failed.
- [x] 3.2 No em dash on added lines. Verify: `git diff origin/qa -U0 | grep '^+' | grep -cP '\x{2014}'` prints 0. Done (spike): printed 0.
- [ ] 3.3 Run `/opsx:verify remove-dead-todo-hook`, then `blast-radius` and the `final-review` skill; fix or list what they find. Verify: their results in the PR.
- [ ] 3.4 Note on #1991 that the matcher change alone restores nothing, linking this change, if Fraser agrees (Clarifications). Verify: comment link in the PR, or ticked as moved with the reason.
