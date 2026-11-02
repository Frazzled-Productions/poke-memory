## 1. Build

- [x] 1.1 Failing tests in `lib/storage/reset.test.ts`. Verify: "clearLocalProgress removes the IDB pending-grade queue", "deleteAccountEverywhere clears the IDB pending-grade queue" and "resetAllProgressEverywhere clears the IDB pending-grade queue", red before the fix (exit 1, 3 failed, 5 passed, each holding the queued row).
- [x] 1.2 Add the delete to `clearLocalProgress`. Verify: the three tests above green, and "keeps the IDB pending-grade queue when the cloud delete or reset fails" stays green.
- [x] 1.3 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.

## 2. Before merge

- [x] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers. Done: "Ruling 2026-11-02 (Fraser)" on #2211 took all five recommended answers; each is recorded, dated, in proposal.md.
- [x] 2.2 `/opsx:verify clear-grade-queue-on-reset`, `blast-radius` again and `final-review`. Verify: findings fixed or listed in the PR. Done 2026-11-03 on `qa`: verify found no critical issue (two scenarios without their own test, accepted by Fraser); blast-radius rung 4 (new line commented out: `reset.test.ts` exit 1, 3 failed, 5 passed; restored: exit 0, 8 passed); four reviewers found no blocker, two proposal wording fixes applied and one Clarification added, listed in the build PR.
