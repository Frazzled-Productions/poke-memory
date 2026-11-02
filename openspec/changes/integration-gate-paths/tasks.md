## 1. Contract test (failing first)

- [x] 1.1 `scripts/integration-gate-paths.test.mjs`: filter covers the suite's imports, `push` trigger on `qa`, no secrets, and the real `Decide` script for each trigger. Verify: red on `qa` at `d2456f44`, exit 1, 3 failed, 6 passed, naming `app/api/push/send-daily/route.ts`, `lib/auth/rateLimitIp`, `lib/idb/db`, `lib/settings/lastPushedSnapshot`, `lib/settings/persistence` and `lib/storage/keys`, and `run=false` on a push.

## 2. Workflow and docs

- [x] 2.1 `integration-tests.yml`: six filter paths, `push` on `qa` with the sprite `paths-ignore`, `Decide` branch for a push, header comment. Verify: task 1.1 green, exit 0, 9 passed; `actionlint` exit 0.
- [x] 2.2 `WORKFLOW.md` and `docs/testing.md`. Verify: `git grep -n "lib/gradelog/\*\*" WORKFLOW.md docs/testing.md` shows both listing the new paths.
- [x] 2.3 Nothing regresses in the suite. Verify: `VITEST_INTEGRATION=1 npx vitest run --project integration` on Node 24 against a local `postgres:15-alpine`, exit 0, 18 files, 179 tests passed.
- [x] 2.4 The old filter loses nothing. Verify: picomatch over the 16,475 tracked files, lost 0, gained 38, plus 2 under `app/api/feedback/**` (`design.md`).
- [x] 2.5 The contract test fails when the gate is weakened. Verify: removing `lib/settings/**`, `app/api/push/**`, `app/api/feedback/**`, the `push` trigger or the `Decide` branch each fails it (independent review, 2 November 2026).

## 3. Gates

- [ ] 3.1 Fraser's calls in the proposal's Clarifications.
- [ ] 3.2 `workflow-expert` review (mandatory for `.github/workflows/**`). This run could not start that sub-agent, so only its checklist was applied by hand, in `design.md`. Verify: the review, in the PR.
- [ ] 3.3 After merge: the first `push` run on `qa` starts and passes, which a PR cannot prove. Verify: the run link; move to its own issue before the build PR merges.
- [ ] 3.4 `/opsx:verify integration-gate-paths`, the second `blast-radius` and `final-review`. Not done in this spike: `final-review` needs four fresh-context reviewers at this diff size. One fresh agent ran all four lenses by hand on 2 November 2026, which does not meet that. Verify: their results, in the PR.
