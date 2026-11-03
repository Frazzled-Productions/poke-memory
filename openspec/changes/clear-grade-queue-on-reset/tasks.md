## 1. Build

- [x] 1.1 Failing tests in `lib/storage/reset.test.ts`. Verify: "clearLocalProgress removes the IDB pending-grade queue", "deleteAccountEverywhere clears the IDB pending-grade queue" and "resetAllProgressEverywhere clears the IDB pending-grade queue", red before the fix (exit 1, 3 failed, 5 passed, each holding the queued row).
- [x] 1.2 Add the delete to `clearLocalProgress`. Verify: the three tests above green, and "keeps the IDB pending-grade queue when the cloud delete fails" and "... when the cloud reset fails" stay green.
- [x] 1.3 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.

## 2. Before merge

- [x] 2.1 Fraser settles the five open calls from the proposal PR. Verify: Clarifications holds his dated answers. Done: "Ruling 2026-11-02 (Fraser)" on #2211 took all five recommended answers; each is recorded, dated, in proposal.md.
- [x] 2.2 `/opsx:verify clear-grade-queue-on-reset`, `blast-radius` again and `final-review`. Verify: findings fixed or listed in the PR. Done 2026-11-03 on `qa`: verify found no critical issue (two scenarios without their own test, accepted by Fraser); blast-radius rung 4 (new line commented out: `reset.test.ts` exit 1, 3 failed, 5 passed; restored: exit 0, 8 passed); four reviewers found no blocker, two proposal wording fixes applied and one Clarification added, listed in the build PR. Second review pass 2026-11-03: the delta now MODIFIES the three existing requirements it made wrong instead of adding a capability (`openspec validate --all --strict` exit 0, 18 passed; archive dry run in a copy: ~3 modified, + 0); the failure test is split in two and the kept queue is cleared after each test (`npx vitest run lib/storage lib/sync` exit 0, 500 passed in 24 files); the upgrade Clarification now names the cross-account case.
