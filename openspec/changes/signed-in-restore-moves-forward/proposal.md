## Why

Restoring a backup while signed in has no defined outcome. The dialog promises to replace your
progress, but the restore only rewrites this device. The cloud keeps its rows, the sync status and
the pending queue are not touched, and the regression trigger refuses anything lower. The result,
seen against real Postgres: this device and the account disagree, a pull does not repair it, and the
next grade on that card is refused and dropped from the queue, so the card stops syncing. Audit
finding 11 (`ops/research/turbo-app-audit-2026-11-01.md`).

Fixes: #2218

## What Changes

This builds the **recommended** answer to the open call in Clarifications. It is not a decision.

- A signed-in restore only moves cards forward. A backup card is used when it is further on than both
  the cloud and this device; otherwise the further-on copy stays. Nothing in the cloud goes down.
- New `restoreBackupSignedIn` (`lib/sync/restoreBackup.ts`) runs load local, pull, merge, save, push,
  the order `docs/sync.md` sets. A failed pull changes nothing. A failed push leaves the cards in the
  pending queue, which drains after the reload.
- New pure `planSignedInRestore` and `isFurtherOn` (`lib/sync/cloud.ts`). `isFurtherOn` mirrors the
  regression trigger and is checked against the real trigger case by case.
- Cards dated before the account's last reset are left out, because the database refuses them on
  every push.
- A signed-in restore leaves settings and daily limits alone.
- Settings shows signed-in wording in the description and the confirmation, and reports a failed
  restore. Guests and superuser sessions keep the current local replace, with the same dialog.
- New capability `backup-restore`: a baseline of current behaviour plus the signed-in requirements.

## Also touches

Evidence from the `blast-radius` run on 2 November 2026 against `origin/qa` at `d2456f44`. The fact
it rests on: nothing is written unless the pull succeeded, and a planned push is one the real trigger
accepts. Proven at rung 4: `backup-restore.test.ts` runs `isFurtherOn` against the real trigger, and
removing its reps guard fails two cases.

- **Settings:** the description and confirmation change for signed-in users, and a failed restore
  shows the existing alert. `app/settings/page.tsx`, `handleImport`.
- **Cloud sync and Supabase migrations (both projects):** a signed-in restore now pulls and pushes
  `card_reviews`. No migration, and no new trigger bypass.
- **Guest mode (localStorage):** no change. `applyBackup` stays as it is, and the page test holds it.
- **Superuser mode and QA-seed scenarios:** no change. With a flag on, cloud writes are suppressed, so
  the restore stays local with the guest dialog; page test "under a superuser flag stays local".
- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey:** no code change. They read the
  saved session after the reload. `grade_log` and `streak_days` are not in a backup, so Stats history
  stays as it was, as it does today.
- **What's new:** no change, this corrects an existing action.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** three new keys, `importDescriptionSignedIn`,
  `importConfirmSignedIn` and `importFailedSignedIn`, in all four catalogues; pseudo-locale regenerated.
- **Push notifications and the service worker (offline):** no code change. On a failed push
  `savePendingQueue` writes the existing queue and its IndexedDB mirror, so the existing replay
  applies. An offline restore fails at the pull and changes nothing.
- **Sign-in:** no change. `guardAccountSwitch` does not run here.
- **Privacy notice and sub-processors:** no change. Restored rows are the same data in the same table
  as any grade.
- **Accessibility (keyboard, screen reader, reduced motion):** no change. It uses the same
  `window.confirm` and the same `role="alert"` line.
- **README screenshots:** no change. Settings is not one of the six surfaces.
- **Changelog fragments and the release:** one `fixed` fragment.
- **CI and GitHub Actions:** no workflow change. `lib/sync/**` already sets off the integration suite,
  which picks up the new test file, and the new real sign-in case runs in the existing `e2e-real-auth`
  job, on the QA project with its ephemeral user.

Risks kept open, each small:

- A background pull landing between this restore's load and save could overwrite the saved session.
  The pushed cards are in the cloud and come back on the next pull. Likelihood low, cost one pull.
- A card the database refuses on other grounds, for example a hand-edited stability, fails its batch of
  200, so that batch falls to the queue, where the refused card is evicted but stays on this device.
  Only a hand-edited file reaches this.

## Out of scope

- Replacing the cloud, or undoing a reset, from a backup. Both need a new bypass (see Clarifications).
- Adding `grade_log` or `streak_days` to the backup file.
- The hard-coded English guest confirmation, and `applyBackup` ignoring a failed save on the guest
  path. Both are existing behaviour on a path this change leaves alone.

## Removes

Nothing, because the guest and superuser paths still use `applyBackup`, and the signed-in path is new
code beside it.

## Owner decisions this relies on

- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 23 October 2026: `root-cause` and `blast-radius` on every bug.
- 1 November 2026: spend waves build as draft PRs, nothing merged (ops #383).

## Clarifications

Nothing here has been put to Fraser yet. Each line is an open call with a recommendation.

- 2026-11-02 Should a signed-in restore replace the cloud, or only local data? Recommended: neither as worded. Cards only move forward, as built here, so the restore recovers lost progress and can never lower the account. Replacing the cloud needs a new `SECURITY DEFINER` bypass, a migration on both Supabase projects and an irreversible write across every device, with point-in-time recovery still deferred (#298); `docs/sync.md` warns against both. Local only is today's behaviour, which strands the card (see design.md).
- 2026-11-02 Should settings restore too? Recommended: no. A patch lowering a guarded field is refused whole (seen against migration 038), which would quietly stop this device's settings syncing. Restoring only unguarded settings is possible, but it needs a second mirror of a trigger.
- 2026-11-02 A backup cannot undo a reset, the case someone is most likely to try it for. Recommended: accept and say so in the dialog, as built. Undoing a reset needs the same bypass as replacing the cloud.
- 2026-11-02 A backup file names no account, so another account's backup would now move this account forward. Recommended: accept for now, because it takes picking the file and confirming, and it only touches the signed-in person's own rows.
- 2026-11-02 The real sign-in case covers an older copy and a newer one. The reset, two-device and failure cases are proven against real Postgres through a stand-in client only. Recommended: accept; they are the same code path, and the triggers involved are the real ones.
- 2026-11-02 The ja, zh-Hans and zh-Hant strings are mine and no native speaker has read them. Recommended: the usual translation check before merge (task 2.2).
- 2026-11-02 The guest dialog stays hard-coded English. Recommended: leave it here and fix it in its own small change.
