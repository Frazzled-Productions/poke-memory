## Root cause

Traced on 2 November 2026 (`root-cause` skill) on `origin/qa` at `d2456f44`. The full analysis is in
ops #400. Surface: unit tests through the real write path against
`fake-indexeddb`; a real browser was not used.

- **Current behaviour (Seen):** seed the queue with `savePendingQueue`, run `clearLocalProgress`,
  `deleteAccountEverywhere` or `resetAllProgressEverywhere`. The localStorage key is gone; the
  IndexedDB key still holds the row.
- **Expected behaviour:** both copies are gone after a successful wipe.
- **Unchanged behaviour:**
  - WHEN the cloud delete or reset fails THEN the queue SHALL CONTINUE TO be kept in IndexedDB.
  - WHEN a progress reset runs THEN `poke-memory:settings:*` and `poke-memory:user-archive:*` SHALL
    CONTINUE TO survive it.
  - WHEN a progress reset runs THEN the review session, grade log and migration flag SHALL CONTINUE
    TO be deleted from IndexedDB.
- **Tried before:** #530 made `clearLocalProgress` clear IndexedDB, before the queue had a copy
  there. #1712 and #1850 clear the copy on an account switch, not on a wipe.
- **Hypotheses ruled out:**
  - The key differs between the app and the service worker: it does not (`app/sw.ts:81`,
    `lib/storage/keys.ts:43`; same database and store, `lib/idb/db.ts`, `app/sw.ts:69-71`).
  - Another step clears it later: `deleteAccountEverywhere`'s sweep is localStorage only
    (`lib/sync/deleteAccount.ts:41-57`).
- **First wrong step (Cited):** #1054 added the IndexedDB copy in `savePendingQueue`
  (`lib/sync/persistence.ts:249`) without adding it to the wipe (`lib/storage/reset.ts:49-53`), and
  no reset test seeds that key.
- **Same fault elsewhere:** `clearSeedScenario` (`lib/qa-seed/apply.ts:156`) also skips the key;
  harmless, because a QA session writes no queue. `lib/storage/userArchive.ts` already clears it.
- **Failing test before the fix:** `lib/storage/reset.test.ts`, three cases.
- **Always-on signal:** the new tests seed the queue through the real write path.

## Approach

Add one `idbDelete` to the existing `Promise.all`. It joins three parallel deletes with no ordering
dependency; `idbDelete` does not throw and is a no-op when IndexedDB is unavailable.

## Safety

The one fact this rests on: every caller of `clearLocalProgress` has already removed the localStorage
copy, so the only reader left for the IndexedDB copy is the service worker, and it treats an empty
queue as nothing to do. Proven to rung 4 (real code, red then green) for the deletion; the service
worker's handling is rung 3, walked but not run, since `app/sw.ts` is outside the unit tests: a
missing key reads as an empty queue (`app/sw.ts:544`), which returns before any request
(`app/sw.ts:678`).
