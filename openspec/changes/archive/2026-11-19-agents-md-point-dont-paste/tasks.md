## 1. Failing check first

- [x] 1.1 With the lowered caps, `node scripts/lint-agents-size.mjs` on today's AGENTS.md fails. Verify: exit code in the PR. Done 2026-11-14: "AGENTS.md is 229/190 lines and 24508/22528 bytes; one of the budgets is exceeded.", exit 1.

## 2. Change

- [x] 2.1 AGENTS.md: the OpenSpec stub, the stall-watcher section deleted, lines 136 and 147 trimmed. Verify: `grep -c -e "scripts/task.sh add --title" -e "archives each active change in name order" AGENTS.md` prints 0. Done: 0.
- [x] 2.2 `.github/context-budget.txt` and `scripts/lint-agents-size.mjs` lowered. Verify: `npm run lint:agents-size` and the shared `context_budget.py` pass. Done: "AGENTS.md is 167/190 lines, 18745/22528 bytes", exit 0; "Context budget: PASSED."

## 3. Gates

- [x] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0 and no added line has an em dash. Verify: exit code and count in the PR.
- [x] 3.2 `/opsx:verify agents-md-point-dont-paste`: tasks all ticked, `skip_specs: true` so no spec to check; the ops change's blast-radius phrase check covers the removed rules. Verify: result in the PR.
- [x] 3.3 ~~Merge into `qa` after the ops build merges~~ Moved to ops #563 (2026-11-14).
