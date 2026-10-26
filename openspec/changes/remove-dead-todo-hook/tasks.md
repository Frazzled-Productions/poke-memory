## 1. Failing check first

- [ ] 1.1 Before any edit, run `jq -e '.hooks.PostToolUse == null' .claude/settings.json && test ! -e .claude/hooks/mirror-todos-to-comment.sh` and record that it exits non-zero (red: the block and script exist). Verify: exit code pasted in the PR.

## 2. Remove the dead hook

- [ ] 2.1 Delete the `PostToolUse` key from `.claude/settings.json`. Verify: the 1.1 check now exits 0.
- [ ] 2.2 Delete `.claude/hooks/mirror-todos-to-comment.sh`. Verify: the 1.1 check exits 0 and `git grep -n mirror-todos` returns nothing.
- [ ] 2.3 Keep the session-start hooks and permissions unchanged (plain check; no spec delta). Verify: `diff <(git show origin/qa:.claude/settings.json | jq -S '.hooks.SessionStart,.permissions') <(jq -S '.hooks.SessionStart,.permissions' .claude/settings.json)` prints nothing, and a fresh `claude` session in the worktree starts with no hook error.

## 3. Gates

- [ ] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0. Verify: exit code pasted in the PR.
- [ ] 3.2 No em dash on added lines. Verify: `git diff origin/qa -U0 | grep '^+' | grep -cP '\x{2014}'` prints 0.
- [ ] 3.3 Run `/opsx:verify remove-dead-todo-hook`, then `blast-radius` and the `final-review` skill; fix or list what they find. Verify: their results in the PR.
- [ ] 3.4 Comment on #1991 (no edit to the issue body) that the matcher change alone restores nothing because the comment it would update is never created since #2003, linking this change, if Fraser agrees (Clarifications). Verify: comment link in the PR, or ticked as moved with the reason.
