## 1. Build

- [x] 1.1 Failing tests first. Verify: `lib/storage/userArchive.test.ts` and `lib/sync/guardAccountSwitch.test.ts` red, and "archive quota failure with non-empty pending queue does not discard the queue" red with "A's grades are kept for A: expected null not to be null".
- [x] 1.2 `archiveUserData` returns a result and hands back the unpushed grades. Verify: "hands back the queue and held grades, and nothing else, when the archive fails" and "hands back nothing when the queue is an empty list".
- [x] 1.3 The guard saves them after the wipe with nulled cursors and the last seen reset. Verify: "saves the unpushed grades under the outgoing user, after the wipe has freed space" and "saves null cursors and the last seen reset with the unpushed grades".
- [x] 1.4 `restoreUserData` keeps an archive after a partial restore. Verify: "partial restore keeps the archive blob" and "keeps the archive blob when an IDB value does not read back".
- [x] 1.5 Real-browser run. Verify: bundled guard in headless Chrome at 40,000 entries, and with localStorage full, returns all three queued grades to A and none to B.
- [x] 1.6 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.
- [x] 1.7 A queue restored after mount is taken up. Verify: "takes up a queue restored after mount, so the next grade cannot replace it (#2208)", red with "expected [ 88 ] to include 77".

## 2. Before merge

- [ ] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 2.2 `/opsx:verify keep-unpushed-grades-on-failed-archive`, `blast-radius` again and `final-review`. Verify: findings fixed or listed in the PR.
