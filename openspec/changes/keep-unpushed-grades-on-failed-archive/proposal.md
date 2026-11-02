## Why

When a different account signs in on a device, `guardAccountSwitch` archives the outgoing user and
wipes their local state. The archive is one localStorage value, so a heavy user's can pass the quota.
`archiveUserData` swallows that and logs "cloud intact", which is false for grades not yet pushed, and
the guard then clears the queue. Seen in real Chrome on `qa`: three queued grades were gone for good
at 40,000 grade-log entries (see design.md). On restore, a key that hits the quota is skipped, yet the
archive is still removed. From audit poke-memory Medium 7.

Fixes: #2208

## What Changes

- `archiveUserData` returns `{ saved: true }` or `{ saved: false, unpushed }`, and stops saying the
  cloud is intact. `unpushed` holds the queue and the held grades, or null when there are none.
- After the wipe, `guardAccountSwitch` stores `unpushed` under the outgoing user's archive key, with
  their SyncStatus, cursors nulled, through the new `saveUnpushedArchive`. `restoreUserData` reads it
  like any archive.
- `restoreUserData` removes an archive only after every localStorage key is written and every
  IndexedDB value reads back, and announces each restore.
- `usePerGradeSync` seeds again on that announcement, because on a username sign-in it is already
  mounted when the restore lands, and its next write would replace the restored queue.
- New capability `account-switch`: a baseline of how the switch behaves today, plus these requirements.
- `docs/sync.md` describes the failure path.

This does not take the audit's fix literally. It says to stop the wipe or push first, and neither is
safe: see Clarifications.

## Also touches

Evidence from `blast-radius` on 2 November 2026 against `origin/qa` at `d2456f44`.

- **Sign-in:** behaviour change on the failure path only. `lib/sync/useSignInPull.ts` still awaits the
  guard before `pullAndMerge`. When the archive saves, nothing changes.
- **Cloud sync and Supabase migrations (both projects):** a restored queue pushes through the existing
  paths (`pushWithFallback`, `usePerGradeSync`). `lastSeenResetAt` is kept because
  `lib/sync/pullAndMerge.ts:175-179` runs `clearLocalProgress` when it is null and the cloud has ever
  been reset, which would wipe the restored queue. No migration, no change to `/api/sync`.
- **Push notifications and the service worker (offline):** the IndexedDB queue is still cleared before
  the localStorage wipe, so the replay cannot post the outgoing user's rows as the incoming user. The
  copy returns only when its owner does.
- **Settings:** no change. Delete account's sweep covers the smaller blob
  (`lib/sync/deleteAccount.ts:49-52`) and a progress reset still spares archives
  (`lib/storage/reset.ts:36`), because it stays in localStorage under the same key.
- **Privacy notice and sub-processors:** no change: no new data, store or processor, and the blob is a
  subset of what the archive already keeps on the device.
- **Guest mode (localStorage):** no change. A null owner returns before the archive step.
- **Superuser mode and QA-seed scenarios:** no change. The guard does not read the superuser flags, and
  `archiveUserData` still skips device-level keys.
- **Review and quiz screens (home):** `usePerGradeSync` seeds again after a restore, for every restore,
  not only a failed archive's. The seed is the existing one, so held grades follow the same rules and
  an entry already in memory still wins. After a failed archive the screen shows the cloud's data once
  the pull finishes, as it already does.
- **Pokédex, Pasture, Stats, Journey:** after a failed archive they show the cloud's data until the
  pull finishes, as they already do; no code change.
- **What's new, locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, no copy. The blob
  keeps each card's `locale`.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, no UI.
- **README screenshots:** no change, no rendered surface changes.
- **Changelog fragments and the release:** one `fixed` fragment.
- **CI and GitHub Actions:** no change. The new integration test runs in the existing job.

## Out of scope

- Keeping the whole archive for a heavy user, including grade-log rows the cloud lacks: #2214.
- Flushing the queue at sign-out.
- `clearLocalProgress` and the queue's IndexedDB copy on a reset: #2211.

## Removes

- The `try`/`catch` round `archiveUserData` in the guard, which could never fire.
- The two guard tests built on a rejection the real function cannot produce, replaced by tests of
  the result it returns.
- The "cloud intact" log line and the doc comment saying the same.

## Owner decisions this relies on

- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 23 October 2026: `root-cause` and `blast-radius` on every bug.
- 1 November 2026: spend waves build as draft PRs, nothing merged (ops #383).

## Clarifications

Nothing here has been put to Fraser yet. Each line is an open call with a recommendation.

- 2026-11-02 The audit says stop the wipe or push first. Neither works: the guard runs once the session is already the incoming user's (`useSignInPull`), so a push cannot write the outgoing user's rows under row-level security, and an unwiped device hands their data to the incoming user, the #1850 leak. Recommended: wipe, and keep the queue under the outgoing user's own key, as built.
- 2026-11-02 After a failed archive, whatever the cloud lacks outside the queue is still lost: grade-log rows, in-step cards (`isSyncSafe` keeps them out of the queue), and any streak days or settings not yet pushed. The session is rebuilt from the cloud. Keeping them means writing the archive to IndexedDB, which adds an erasure path to Delete account. Recommended: land this first and decide on #2214 separately.
- 2026-11-02 Proven in real Chrome 156 only. WebKit was not run, because Playwright's browsers are not installed here, and Safari has its own quota behaviour. Recommended: accept, since the code path only needs `setItem` to throw, which every browser does at quota.
- 2026-11-02 If even the small blob cannot be written, the grades are lost and only `console.error` says so. By then neither store can take a write and the wipe has freed its own space. Recommended: accept, with no Sentry event.
- 2026-11-02 An archive kept after a partial restore stays until the next archive of that user overwrites it. If that next archive fails with no grades queued, the older blob stays and is restored on their return, where the merge and the reset check still apply. Recommended: accept.
