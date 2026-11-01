## 1. Contract test (failing first)

- [x] 1.1 `scripts/integration-gate-paths.test.mjs`: filter covers the suite's imports, `push` trigger on `qa`, no secrets, and the real `Decide` script for each trigger. Verify: red on `qa` at `d2456f44`, exit 1, 3 failed, 6 passed, naming `app/api/push/send-daily/route.ts`, `lib/auth/rateLimitIp`, `lib/idb/db`, `lib/settings/lastPushedSnapshot`, `lib/settings/persistence` and `lib/storage/keys`, and `run=false` on a push.

## 2. Workflow and docs

- [x] 2.1 `integration-tests.yml`: five filter paths, `push` on `qa` with the sprite `paths-ignore`, `Decide` branch for a push, header comment. Verify: task 1.1 green, exit 0, 9 passed; `actionlint` exit 0.
- [x] 2.2 `WORKFLOW.md` and `docs/testing.md`. Verify: `git grep -n "lib/gradelog/\*\*" WORKFLOW.md docs/testing.md` shows both listing the new paths.
- [x] 2.3 Nothing regresses in the suite. Verify: `VITEST_INTEGRATION=1 npx vitest run --project integration` on Node 24 against a local `postgres:15-alpine`, exit 0, 18 files, 179 tests passed.
- [x] 2.4 The old filter loses nothing. Verify: picomatch over the 16,475 tracked files, lost 0, gained 38 (`design.md`).

## 3. Gates

- [ ] 3.1 Fraser's calls in the proposal's Clarifications.
- [ ] 3.2 `workflow-expert` review (mandatory for `.github/workflows/**`). This run could not start that sub-agent, so only its checklist was applied by hand, in `design.md`. Verify: the review, in the PR.
- [ ] 3.3 After merge: the first `push` run on `qa` starts and passes, which a PR cannot prove. Verify: the run link; move to its own issue before the build PR merges.
- [ ] 3.4 `/opsx:verify integration-gate-paths`, the second `blast-radius` and `final-review`. Not run in this spike: `final-review` needs fresh-context reviewers, which this run could not start. Verify: their results, in the PR.
