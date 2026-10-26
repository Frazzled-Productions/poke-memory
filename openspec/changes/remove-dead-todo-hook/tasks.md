## 1. Failing check first

- [x] 1.1 Before any edit, run `jq -e '.hooks.PostToolUse == null' .claude/settings.json && test ! -e .claude/hooks/mirror-todos-to-comment.sh` and record that it exits non-zero (red: the block and script exist). Verify: exit code pasted in the PR. Done 2026-10-26 at `849784f3`: `jq` printed `false`, exit 1 (`~/.local/state/frazzled/spend/build-2026-10-26/poke-memory-2178-red.log`).

## 2. Remove the dead hook

- [x] 2.1 Delete the `PostToolUse` key from `.claude/settings.json`. Verify: the 1.1 check now exits 0. Done with `jq 'del(.hooks.PostToolUse)'` (11 lines removed, no other line changed); the 1.1 check printed `true`, exit 0 (green log).
- [x] 2.2 Delete `.claude/hooks/mirror-todos-to-comment.sh`. Verify: the 1.1 check exits 0 and `git grep -n mirror-todos` returns nothing outside this change's own documents. Done: 1.1 exit 0; `git grep -n mirror-todos -- ':!openspec/changes'` exit 1, no matches (green log).
- [x] 2.3 Keep the session-start hooks and permissions unchanged (plain check; no spec delta). Verify: `diff <(git show origin/qa:.claude/settings.json | jq -S '.hooks.SessionStart,.permissions') <(jq -S '.hooks.SessionStart,.permissions' .claude/settings.json)` prints nothing, and a fresh `claude` session in the worktree starts with no hook error. Done: diff empty, exit 0; `.hooks` keys are `["SessionStart"]`; a fresh headless `claude -p` session (2.1.310) in the worktree exited 0 with 8 `SessionStart` hook responses, all `success`, and 0 non-success hook responses (green log).

## 3. Gates

- [x] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0. Verify: exit code pasted in the PR. Done: exit 0, 3 passed, 0 failed.
- [x] 3.2 No em dash on added lines. Verify: `git diff origin/qa -U0 | grep '^+' | grep -cP '\x{2014}'` prints 0. Done: 0.
- [x] 3.3 Run `/opsx:verify remove-dead-todo-hook`, then `blast-radius` and the `final-review` skill; fix or list what they find. Verify: their results in the PR. Done: results in the build PR body; blast-radius log at `~/.local/state/frazzled/spend/build-2026-10-26/poke-memory-2178-blast.log`.
- [x] 3.4 Comment on #1991 (no edit to the issue body) that the matcher change alone restores nothing because the comment it would update is never created since #2003, linking this change (Fraser said yes on 2026-10-26, Clarifications). Verify: comment link in the PR. Done: https://github.com/Frazzled-Productions/poke-memory/issues/1991#issuecomment-6422948006
