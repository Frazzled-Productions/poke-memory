## Why

Reset all progress and Delete account should leave no progress on the device. Both remove the
pending-grade queue from localStorage, but leave its copy in IndexedDB, the one the service worker
reads for Background Sync. The two copies should go together, as they already do in
`clearPendingQueue` and on an account switch. Refs ops #400 (held privately in
Frazzled-Productions/ops).

Fixes: ops #400

## What Changes

- `clearLocalProgress` (`lib/storage/reset.ts`) also deletes `KEY_PENDING_GRADE_QUEUE` from IndexedDB.
  Everything that wipes local progress goes through it, so one line covers them all.
- New capability `local-progress-reset`: a baseline of how the wipe behaves today, plus the one new
  requirement.
- `docs/sync.md` says the queue's two copies are also cleared on a reset or delete.

## Also touches

Evidence from the `blast-radius` run on 2 November 2026 against `origin/qa` at `d2456f44`.

- **Settings:** behaviour change, not visual. Reset all progress and Delete account clear the queue
  copy. `app/settings/page.tsx:681-684`, `lib/sync/reset.ts`, `lib/sync/deleteAccount.ts`.
- **Cloud sync and Supabase migrations (both projects):** the reset-on-another-device path in
  `lib/sync/pullAndMerge.ts` clears the copy too, matching the localStorage copy it already wiped. No
  migration, no change to `/api/sync`.
- **Guest mode (localStorage):** no real change. The guest reset and the error page's reset
  (`app/error.tsx:133`, shown to guests only) run the new delete, but guests do not write the queue
  (`docs/sync.md`, "Superuser guard").
- **Push notifications and the service worker (offline):** no code change. An empty queue is already
  a handled case (`app/sw.ts:678`, "Nothing to push"). A sync tag still registered resolves there.
- **Superuser mode and QA-seed scenarios:** no change. `clearSeedScenario` does not call
  `clearLocalProgress`, and a superuser session writes no queue.
- **Sign-in:** no change. `guardAccountSwitch` does not call `clearLocalProgress`, and archived blobs
  keep their own copy of the queue (`lib/storage/userArchive.ts:71`).
- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change. None
  reads the IndexedDB queue; only `app/sw.ts` does.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, no copy.
- **Privacy notice and sub-processors:** no change, because no new data or processor is involved.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, no UI.
- **README screenshots:** no change, no rendered surface changes.
- **Changelog fragments and the release:** one `fixed` fragment.
- **CI and GitHub Actions:** no change.

## Out of scope

- Changing what the service worker does with the queue, or the account-switch path.
- A shared list of per-user IndexedDB keys (see Clarifications).
- `clearSeedScenario`, which leaves the key alone for the reason above.

## Removes

Nothing, because this adds a delete the wipe was missing and makes no code dead.

## Owner decisions this relies on

- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 23 October 2026: `root-cause` and `blast-radius` on every bug.
- 1 November 2026: spend waves build as draft PRs, nothing merged (ops #383).

## Clarifications

Nothing here has been put to Fraser yet. Each line is an open call with a recommendation.

- 2026-11-02 How much of the reason is public? Recommended: behaviour wording only, as here, with the detail staying in ops #400.
- 2026-11-02 A grade still queued when a wipe runs is now dropped. The localStorage copy and the session were already wiped, so nothing on the device could show it. Recommended: accept; that is what a reset means.
- 2026-11-02 This is proven against `fake-indexeddb` through the real write path, not in a real browser. Recommended: accept for a one-line delete, with no new Playwright case.
- 2026-11-02 Should the wipe and `lib/storage/userArchive.ts` share one list of per-user IndexedDB keys, so a new key cannot be missed again? Recommended: not in this change; `keys.ts` has few IndexedDB keys and one new one has been added since the wipe was written.
