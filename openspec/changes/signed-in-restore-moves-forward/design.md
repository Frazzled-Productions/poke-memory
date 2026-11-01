## Root cause

Traced on 2 November 2026 (`root-cause` skill) on `origin/qa` at `d2456f44`. Surface: real
`applyBackup`, `pullAndMerge` and `pushSingleCard` over real Postgres with every migration, through a
stand-in client and an in-memory browser. A real sign-in was not used.

- **Current behaviour (Seen):** the cloud holds a card at reps 9 and this device has pulled it.
  Restore a backup holding reps 4, then run a full pull. Output with today's restore:

  ```
  AssertionError: expected 4 to be 9     (this device stays on the restored copy after the restore)
  AssertionError: expected 'rejected' to be 'ok'     (the next grade, after a pull, is refused)
  ```

  A backup ahead of the cloud never reaches it (`expected 4 to be 9`, reading the cloud row), a card
  the cloud lacks is not added, and a grade still in the queue is overwritten on this device
  (`expected 3 to be 5`). After a reset the restored card stays on the device while the cloud has none
  (`expected '2026-10-02' to be null`), and the pre-reset trigger refuses it on every push.
- **Expected behaviour:** the outcome is an open call. Under the recommendation, this device and the
  cloud agree after a restore, nothing in the cloud goes down, and later grades sync.
- **Unchanged behaviour:**
  - WHEN a guest confirms a restore THEN the session and settings SHALL CONTINUE TO be replaced locally.
  - WHEN a superuser flag is on THEN a restore SHALL CONTINUE TO stay local.
  - WHEN a file is invalid THEN no dialog SHALL CONTINUE TO appear and nothing is written.
  - WHEN a card is pushed lower than the cloud THEN the regression trigger SHALL CONTINUE TO refuse it.
- **Tried before:** nothing for this symptom. The restore (#124, #126) landed on 9 May 2026, the same
  day as sync, and has not changed its logic since. Later rules (the trigger's reps guard in migration
  015, the pre-reset trigger in 022) were never carried back to it.
- **Hypotheses ruled out:**
  - The audit's "the next pull merges cloud rows back": not for a card the cloud has not changed. The
    pull keeps local when the row is unchanged since `lastPullAt` (`lib/sync/cloud.ts:656`), so the
    restored copy stays. Seen: `pullAndMerge` returned ok and the card stayed at 4. The audit's line
    holds only for rows changed since the last pull, or cards this device lacks.
  - Something else pushes the restored session: nothing does. `pushSession` has one caller outside
    `lib/sync/cloud.ts`, the sign-in claim in `app/auth/callback-complete/page.tsx`.
- **First wrong step (Cited):** `applyBackup` (`lib/backup/io.ts:115`) and `handleImport`
  (`app/settings/page.tsx:704`) treat every restore as a local replace, with no
  signed-in branch, so a signed-in restore breaks the cloud's forward-only rule on the device.
- **Same fault elsewhere:** the settings half. `user_settings_reject_regression` refuses a whole patch
  that lowers a guarded field (seen: `REFUSED 23514 ... earnedBadge id b removed`, and a later change
  in the same patch refused with it), and `AutoSyncOnChange` keeps its snapshot on a refusal, so it
  resends those keys on every save. Inferred from the code: this device's settings stop syncing.
- **Failing test before the fix:** `lib/sync/integration/backup-restore.test.ts`, with
  `restoreBackupSignedIn` stubbed to today's `applyBackup`: exit 1, 8 failed, 18 passed. The passes
  are the trigger facts, which hold today too.
- **Always-on signal:** the contract cases in that file. A change to the regression trigger that is
  not carried to `isFurtherOn` fails them.

## Decisions

- **Reuse the cloud's own rule.** "Further on" means what the trigger allows, so a planned push is one
  the database accepts, and the rule has one meaning across the app. A pure mirror plus a real-trigger
  test keeps it honest, rather than trying each row and reading the refusal.
- **Compare against this device as well as the cloud.** That one rule covers the pending queue: a
  grade waiting to sync is on this device, so it stays and the queue is left alone, with no
  queue-specific logic.
- **Do not move `lastPullAt`.** The restore is not a pull. Leaving the cursor means a device that was
  behind the cloud before the restore catches up as usual on the next pull.
- **`pushSession`, then the queue on failure.** One batch call covers a large restore. A refused row
  fails its batch; the queue then drains card by card, and that path already evicts refusals.
- **Migrate backup cards first.** `validateBackup` accepts older shapes, and `applyBackup` relied on
  `loadSession` to bring them up to date. Those shapes must not reach a push.
