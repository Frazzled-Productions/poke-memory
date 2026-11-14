## Why

When a batch reaches `POST /api/sync` and one stale card makes Postgres abort it with `23514`, the
route retries the batch row by row and then reports the wrong outcome. A grade can stay off the cloud
while the client is told all is well, and a queue holding one stale card shows a false "Sync failed"
banner. Fixes #2206 (finding 4 of the 1 November app audit, `ops/research/turbo-app-audit-2026-11-01.md`).

## What Changes

- **A row that fails for an unknown reason now fails the request.** The route returns 502, so the
  client keeps its queue and replays it. Today, if any other row landed, it returns 200 and the client
  clears the queue.
- **Rejected rows no longer count as failures.** A batch whose only failures are `23514` rejections
  returns 200, even when no row landed. Today it returns 502.
- **A structural error on a single row returns 409**, with its SQLSTATE, and stops the request, as a
  structural error on a batch already does. Today it is a warning.
- **A thrown per-row error is logged.** Today it is swallowed with no log line.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no code
  change. `SyncStatusLine` shows fewer false "Sync failed" banners and a true one when a row really
  failed.
- **Guest mode (localStorage):** no change, the route returns 401 before any upsert.
- **Cloud sync and Supabase migrations (both projects):** `app/api/sync/route.ts` changes; no
  migration. `lib/sync/useSyncOnUnload.ts` and `pushSingleCard` do not change.
- **Superuser mode and QA-seed scenarios:** no change, the write guard is client-side.
- **Locales:** no new copy.
- **Push notifications and the service worker (offline):** `app/sw.ts` does not change. It keeps its
  rule (2xx clears the queue, anything else retries), so it stops retrying a stale-only queue and
  starts retrying a real failure.
- **Sign-in, privacy notice and sub-processors:** no change, same data and same services.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `fixed` fragment. Safe to release alone: no migration
  or ordering.
- **CI and GitHub Actions:** no workflow change. One new file in the existing integration project.
- **Docs:** one paragraph in `docs/sync.md`.

## Removes

- The `batchHadGoodRow` flag and the rule "the batch is ok when at least one row landed".
- The silent `catch` around each per-row upsert.

## Out of scope

- The `pagehide` path. `sendBeacon` cannot read a response, so it clears the queue on the browser's
  "queued" answer (`lib/sync/useSyncOnUnload.ts:106-120`) and a 502 there is still invisible. Documented
  limitation; the `visibilitychange` push, which reads the response, usually runs first.
- Retrying a failed row inside the request.
- The other audit findings.
- The trigger's same-day re-grade limitation (`docs/sync.md`).

## Owner decisions relied on

- 2026-10-21: every change goes through OpenSpec, bug fixes included, with spec on touch.
- 2026-10-22: never archive by hand.

## Clarifications

No grilling yet: this proposal was drafted by a scheduled run, so every call below is open for Fraser.
Each has a recommended answer, which the code assumes.

- 2026-11-02 Open call 1: `23514` also comes from the table CHECKs (`difficulty`, `stability`,
  `fsrs_state`, `locale`), not only the regression trigger, so a malformed row now gets 200 and leaves
  the queue, where alone it used to get a 502 and stay. Recommended: accept, because it can never land
  and `pushSingleCard` already evicts on any `23514`. One exception to "never": a client that ships a
  value before the migration widening its CHECK (a fifth locale, say) would lose those rows silently.
  `docs/sync.md` already requires the migration first, and today the four locales match
  `SUPPORTED_LOCALES`. The alternative is matching the trigger's message
  or the constraint name, which ties the route to Postgres wording.
- 2026-11-02 Open call 2: after a structural error on a row, stop or finish the other rows?
  Recommended: stop, the same as the batch path. The client keeps its queue on a 409, so nothing is
  lost.
- 2026-11-02 Open call 3: retry a failed row inside the request? Recommended: no. The 502 makes the
  client replay the queue, and replaying cannot regress a guarded column (design.md). A retry would add up to 200
  rows of delay to a request made while the page is closing.
