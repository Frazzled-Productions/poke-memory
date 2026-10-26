## 1. Failing check first

- [x] 1.1 Before any edit, run `jq -e '.hooks.PostToolUse == null' .claude/settings.json && test ! -e .claude/hooks/mirror-todos-to-comment.sh` and record that it exits non-zero (red: the block and script exist). Verify: exit code pasted in the PR. Done (rework 2026-10-26): exit=1 on `proposal/fix-1991` at `0c7550b7` (`jq` printed `false`); log `~/.local/state/frazzled/spend/2026-10-25-2/evidence/poke-memory-2180-red.log`.

## 2. Remove the dead hook

- [x] 2.1 Delete the `PostToolUse` key from `.claude/settings.json`. Verify: the 1.1 check now exits 0. Done (rework 2026-10-26): exit=0 on the merged spike; log `~/.local/state/frazzled/spend/2026-10-25-2/evidence/poke-memory-2180-green.log`.
- [x] 2.2 Delete `.claude/hooks/mirror-todos-to-comment.sh`. Verify: the 1.1 check exits 0 and `git grep -n mirror-todos` returns nothing. Done (rework 2026-10-26): 1.1 check exit=0; plain `git grep -n mirror-todos` matches only this change's own `proposal.md`, `design.md` and `tasks.md`, and `git grep -n mirror-todos -- ':!openspec/changes/remove-dead-todo-hook'` exit=1 (no matches).
- [x] 2.3 Keep the session-start hooks and permissions unchanged (plain check; no spec delta). Verify: `diff <(git show origin/qa:.claude/settings.json | jq -S '.hooks.SessionStart,.permissions') <(jq -S '.hooks.SessionStart,.permissions' .claude/settings.json)` prints nothing, and a fresh `claude` session in the worktree starts with no hook error. Done (rework 2026-10-26): the `diff` printed nothing (exit 0); headless `claude -p` in the worktree exited 0, all 15 `SessionStart` hook responses `outcome: success`, result "ok".

## 3. Gates

- [x] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0. Verify: exit code pasted in the PR. Done (rework 2026-10-26, merged tree with `skip_specs: true`): exit 0, 2 passed, 0 failed.
- [x] 3.2 No em dash on added lines. Verify: `git diff origin/qa -U0 | grep '^+' | grep -cP '\x{2014}'` prints 0. Done (rework 2026-10-26): printed 0.
- [ ] 3.3 Run `/opsx:verify remove-dead-todo-hook`, then `blast-radius` and the `final-review` skill; fix or list what they find. Verify: their results in the PR.
- [ ] 3.4 Comment on #1991 (no edit to the issue body) that the matcher change alone restores nothing because the comment it would update is never created since #2003, linking this change, if Fraser agrees (Clarifications). Verify: comment link in the PR, or ticked as moved with the reason.
