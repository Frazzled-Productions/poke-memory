## 1. Build

- [x] 1.1 Failing tests in `lib/sync/integration/backup-restore.test.ts`, with `restoreBackupSignedIn` stubbed to today's `applyBackup`. Verify: exit 1, 8 failed, 18 passed, each failure on the behaviour in design.md (for example `expected 'rejected' to be 'ok'`).
- [x] 1.2 `isFurtherOn` and `planSignedInRestore` in `lib/sync/cloud.ts`, `restoreBackupSignedIn` in `lib/sync/restoreBackup.ts`. Verify: the integration file green, including the case-by-case run against the real trigger, and `lib/sync/restoreBackup.test.ts`.
- [x] 1.3 Settings wiring and three catalogue keys in every locale. Verify: "SettingsPage - backup restore (#2218)" in `app/settings/page.test.tsx`, `npm run lint`.
- [x] 1.4 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.

## 2. Before merge

- [ ] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 2.2 Walk a signed-in restore on a QA preview with a real account: an older backup, a newer one and one after a reset. Verify: a screenshot and the `card_reviews` rows.
- [ ] 2.3 Translation check of the three new strings in ja, zh-Hans and zh-Hant. Verify: reviewer named in the PR.
- [ ] 2.4 `/opsx:verify signed-in-restore-moves-forward`, `blast-radius` again and `final-review`. Verify: findings fixed or listed in the PR.
