## Root cause

Traced on 2 November 2026 (`root-cause` skill) on `origin/qa` at `d2456f44`. Surface: the real
`guardAccountSwitch` and `userArchive` bundled into a page in headless Chrome 156, with real
localStorage and real IndexedDB. Not the deployed app, and not Safari.

- **Current behaviour (Seen):** seed 40,000 grade-log entries, a session and three queued grades as
  user A, then switch to B and back. `archiveChars: 0`, the log shows `QuotaExceededError ... cloud
  intact`, and A returns with `lsQueue: 0, idbQueue: false`. At 20,000 entries the archive fits at
  3,986,410 characters and all three come back.
- **The limit (Seen):** Chrome refuses a value above about 5,242,000 characters. The archive costs
  about 180 characters an entry after JSON escaping, so it fails near 27,000 entries (Inferred from
  those two measurements).
- **Expected behaviour:** A's queue and held grades come back when A returns; B never sees them.
- **Unchanged behaviour:**
  - WHEN the archive saves THEN the switch SHALL CONTINUE TO restore A's full state and cursors.
  - WHEN any archive fails THEN the guard SHALL CONTINUE TO wipe, so B gets nothing of A's.
  - WHEN a guest or the same user signs in THEN the guard SHALL CONTINUE TO do nothing.
  - WHEN a progress reset runs THEN archives SHALL CONTINUE TO survive it.
- **Tried before:** #1712 built the archive and the "best effort" rule. #1850 added the IndexedDB wipe,
  which made the failure worse: until then the session survived a failed archive in IndexedDB. #1856
  stopped resets deleting other users' archives.
- **Hypotheses ruled out:**
  - The quota cannot be reached: Seen, it is reached in Chrome.
  - The guard's `catch` handles this: `archiveUserData` catches everything, so it cannot fire
    (`lib/storage/userArchive.ts:128`). The two tests that exercised it mocked a rejection.
- **First wrong step:** `lib/storage/userArchive.ts:128-131` turns a failed write into success, on the
  stated premise that the cloud has a copy. The queue exists because it does not.
- **Same fault elsewhere:** `restoreUserData` skipped a failed key but removed the blob anyway
  (`lib/storage/userArchive.ts:170-180`). `idbSet` also swallows failures, so a restore could not see
  one; it now reads back.
- **Failing test that lands before the fix:** `archive quota failure with non-empty pending queue does
  not discard the queue`.
- **Always-on signal:** the new `console.warn` on failure and `console.error` if the small blob fails.

## Decisions

**Save the queue after the wipe.** The wipe frees the space, including the queue's own localStorage
copy, so the small blob fits even when localStorage was already full. It runs in the same task as the
wipe, with no `await` between them, so no crash can land there. If the tab dies before the wipe,
`ownerUserId` is still A and the guard runs again on the next load.

**Reuse the archive format.** A smaller `ArchiveBlob` under the same key needs no second restore path,
no new key and no new erasure path.

**Keep the SyncStatus, with cursors nulled.** With no session restored, kept cursors would make the
pull incremental and leave the session empty. A status that was fully fresh would have a null
`lastSeenResetAt`, and `pullAndMerge` would then wipe the queue for anyone who has ever reset.
Keeping `lastPushFailed` lets the reconnect push pick the queue up.

**A kept queue value of `[]` is not a grade.** `hasGrades` skips it, so an empty queue writes no blob.

## Risks

- **Not changed, Inferred:** if `ReviewSession` is mounted while the guard restores, it seeds its queue
  before the restore lands, and the next grade's `persistQueue` overwrites the restored queue
  (`lib/sync/usePerGradeSync.ts:176-179,507`). The same applies to the full archive today. Sign-in
  through `app/api/auth/callback/route.ts` lands on `/auth/callback-complete`, where it is not
  mounted, so this needs an in-page sign-in. Not reproduced.
- **Cleared:** an old blob reads the same, the format is unchanged, so an upgrade and a rollback are
  both safe. A retained blob cannot restore over newer data without passing the merge and reset check.
