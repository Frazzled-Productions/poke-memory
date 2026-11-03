## 1. Build

- [x] 1.1 Failing tests in `lib/sync/integration/backup-restore.test.ts`, with `restoreBackupSignedIn` stubbed to today's `applyBackup`. Verify: exit 1, 8 failed, 18 passed, each failure on the behaviour in design.md (for example `expected 'rejected' to be 'ok'`).
- [x] 1.2 `isFurtherOn` and `planSignedInRestore` in `lib/sync/cloud.ts`, `restoreBackupSignedIn` in `lib/sync/restoreBackup.ts`. Verify: the integration file green, including the case-by-case run against the real trigger, and `lib/sync/restoreBackup.test.ts`.
- [x] 1.3 Settings wiring and three catalogue keys in every locale. Verify: "SettingsPage - backup restore (#2218)" in `app/settings/page.test.tsx`, `npm run lint`.
- [x] 1.4 `docs/sync.md` and a `fixed` changelog fragment. Verify: `npm run lint`.
- [x] 1.5 Real sign-in case in `e2e/auth-real.spec.ts`: a real browser, session and RLS against the QA project. Verify: `e2e-real-auth` green on this PR. The case was not run red, because that job needs the QA secrets and a build; its cloud assertion can only pass through the restore's push.
- [x] 1.6 Unit tests for `pullLastResetAt` in `lib/sync/settings.test.ts`, closing the diff-coverage gap (`lib/sync/settings.ts` 0 / 12). Verify: `vitest run lib/sync/settings.test.ts`, exit 0, 48 passed; with coverage on, lines 205 to 216 no longer uncovered (settings.ts 100% functions, 100% branches).
- [x] 1.7 Review fixes: future-dated backup cards left out, an older queued copy of a pushed card dropped after a successful push, a separate `importSaveFailedSignedIn` message, the signed-in check computed once in Settings, the delta moved onto `local-data-and-backup`. Verify: new cases in `lib/sync/restoreBackup.test.ts` ("drops a queued older copy...", "leaves out a card dated after tomorrow...") and `app/settings/page.test.tsx` ("...cannot save on this device...") failed on `320fc200` (3 failed) and pass after; `openspec validate --all --strict` 18 passed.

## 2. Before merge

- [x] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers. Done: "Ruling 2026-11-02 (Fraser)" on PR #2228, move forward only, as built, copied into proposal.md.
- [x] 2.2 Translation check of the three new strings in ja, zh-Hans and zh-Hant. Verify: reviewer named in the PR. Done 3 November 2026 by Claude, under Fraser's standing poke-memory directive (2026-10-26) to check translations: the ja, zh-Hans and zh-Hant strings say the same as en, use the catalogue's existing words for restore and reset, and need no change. The fourth string, `importSaveFailedSignedIn` (task 1.7), was written and checked the same way on 3 November 2026.
- [x] 2.3 `/opsx:verify signed-in-restore-moves-forward`. Verify: result in the PR. Done 3 November 2026: 7 of 7 requirements mapped to code and tests, strict validation 18 passed.
- [x] 2.4 `blast-radius` again and `final-review` with four reviewers at head `320fc200`. Verify: findings fixed or listed in the PR. Done 3 November 2026: correctness, security, blast-radius (200,000-plan fuzz against a transcription of the trigger, 0 failures) and OpenSpec reviewers; every finding fixed in task 1.7, none left open.
