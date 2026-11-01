## 1. Build

- [x] 1.1 Failing tests in `lib/sync/integration/backup-restore.test.ts`, with `restoreBackupSignedIn` stubbed to today's `applyBackup`. Verify: exit 1, 8 failed, 18 passed, each failure on the behaviour in design.md (for example `expected 'rejected' to be 'ok'`).
- [x] 1.2 `isFurtherOn` and `planSignedInRestore` in `lib/sync/cloud.ts`, `restoreBackupSignedIn` in `lib/sync/restoreBackup.ts`. Verify: the integration file green, including the case-by-case run against the real trigger, and `lib/sync/restoreBackup.test.ts`.
- [x] 1.3 Settings wiring and three catalogue keys in every locale. Verify: "SettingsPage - backup restore (#2218)" in `app/settings/page.test.tsx`, `npm run lint`.
- [x] 1.4 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.
- [x] 1.5 Real sign-in case in `e2e/auth-real.spec.ts`: a real browser, session and RLS against the QA project. Verify: `e2e-real-auth` green on this PR. The case was not run red, because that job needs the QA secrets and a build; its cloud assertion can only pass through the restore's push.

## 2. Before merge

- [ ] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 2.2 Translation check of the three new strings in ja, zh-Hans and zh-Hant. Verify: reviewer named in the PR.
- [ ] 2.3 `/opsx:verify signed-in-restore-moves-forward`, `blast-radius` again and `final-review`. Verify: findings fixed or listed in the PR.
