## Why

Daily reminders and streak nudges go out from two separate hourly runs, each sending to one device
at a time. A send has no time limit, so one push service that is slow to answer holds up every device
after it in that run, and the run can end before it clears dead subscriptions. Reminders should reach
people on time whatever one push service does. Refs ops #380.

## What Changes

- **Every send has a hard time limit.** A shared helper, `lib/push/deliver.ts`, gives each send a
  10 second socket timeout and a 15 second overall limit. Both are needed: the library's timeout only
  covers silence, so a response that keeps arriving slowly outlasts it (proven, see design.md).
- **One slow send cannot hold up the others.** The helper sends through a pool of at most 20 at
  once, in the existing order. `send-daily` and `send-streak-nudge` both use it and stop duplicating
  the send loop.
- **A run that starts sending always finishes.** Both routes set `maxDuration = 300`. The helper
  starts no new send once 240 seconds have passed since the route started, reads included, so dead
  subscriptions are still cleared and the route still responds. Devices not reached are counted in a
  log line. The reads have no limit of their own: one that hangs past 300 seconds still ends the
  function with no response, but no sends have run by then, so no dead rows are lost.
- **Subscriptions must point at a known push service.** Apple, Google, Mozilla and Microsoft hosts
  only, checked in `resubscribe`, at send time and by a database constraint. The next migration adds
  the constraint as `NOT VALID`; validating it waits for the check of existing rows (open call 1 and
  ops #416).
- **At most 10 subscriptions per account**, enforced in the database (open call 2).

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change, none
  of them read `push_subscriptions` or call the send routes.
- **Settings:** no new UI. `PushOptIn` already shows the failure state from `subscribeToPush`
  (`persist-failed`), which a browser using an unknown push service would now reach. `PushOptIn` only
  renders on the Settings page, and it is the only caller of `reconcileSubscription`
  (`lib/push/subscribe.ts:315`), so these both happen when Settings is opened on that device: an
  unknown host gets `disabled`, with or without a row, and a device whose row was replaced at the
  limit re-inserts it. Without the first, a skipped row would leave the toggle on while reminders
  have stopped, because a row existing returns `in-sync` today.
- **Guest mode (localStorage):** no change, push is signed-in only (`lib/push/subscribe.ts:6`).
- **Cloud sync and Supabase migrations (both projects):** one new migration, next free number after
  048, on `push_subscriptions` only: a `NOT VALID` check and a `BEFORE INSERT` trigger. Sync only
  reads a count of this table (`lib/sync/pushSubscriptions.ts:36`), which stays valid under the limit.
- **Superuser mode and QA-seed scenarios:** no change, the send routes run on the server from cron
  and the write guard is client-side.
- **Locales:** no new translated copy. Reminder text is unchanged in en, ja, zh-Hans, zh-Hant and the
  pseudo-locale, and the privacy notice is not translated.
- **Push notifications and the service worker (offline):** the two send routes and `resubscribe`
  change. `app/sw.ts` does not. Its `pushsubscriptionchange` handler posts to `resubscribe` and now
  gets a 400 for an unknown push service. Devices may receive a reminder in a different order within
  the hour.
- **Sign-in:** no change.
- **Privacy notice and sub-processors:** same data, same push services and no new sub-processor, but
  the notice lists when a subscription is deleted (`app/privacy/page.tsx`), and the limit of 10 adds a
  case. `docs/dpia.md:103` names Google, Mozilla and Apple, and the list here also has Microsoft.
  Task 5.2 updates both.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `fixed` fragment, worded like this proposal. Release
  needs the migration on both projects, QA first: `migration-check.yml` fails a `db/migrations` PR
  into `qa` until QA has it (`docs/persistence.md:77`).
- **CI and GitHub Actions:** no workflow change. Fixtures that use `https://push.example/...` against
  a real database must move to an allowed host: `lib/sync/integration/push-targets-rpc.test.ts:123`.
  The send route tests mock the database but use the same host, so their fixtures move too, because
  the send-time check would skip them, and so do the `resubscribe` route tests
  (`app/api/push/resubscribe/route.test.tsx:117-152`), which would get a 400. `e2e/settings.spec.ts:596`
  stays: its insert goes to the mock client (`lib/auth/mockAuth.ts:178`), which writes nothing.
  Draft #2222 (RLS coverage test) seeds `https://push.example/rls` at the latest schema, so whichever
  lands second moves that fixture. Draft #2227 seeds `push.example.test` at a cut-off, which needs a
  check when both exist. Those two, draft #2225 and draft #2221 also edit `docs/persistence.md`.

## Removes

- The two copies of the send loop in `send-daily` and `send-streak-nudge`. Each route keeps its own
  delete step.
- The three stale "cron is still daily" comments in `send-daily/route.ts` (the header block, and the
  two inside `POST`), which migration 031 made wrong.

## Out of scope

- The other findings in the same audit (ops #378).
- Retrying devices a run did not reach. A device is due in one hour of the day, so its next reminder
  is tomorrow's. Order is stable, so the same devices are the ones missed if a run keeps running out.
- Moving sends to a queue.
- Grouping or de-duplicating a user's devices.

## Owner decisions relied on

- 2026-10-21: every change goes through OpenSpec, bug fixes included, with spec on touch.
- 2026-10-22: never archive by hand.

## Clarifications

No grilling yet: this proposal was drafted by a scheduled run, so every call below is open for Fraser.
Each has a recommended answer, which the documents assume.

- 2026-11-01 Open call 1: what happens to existing rows on a host outside the list? Recommended: run
  a read-only count by host on both projects first, skip those rows at send time, then delete them
  and validate the constraint in ops #416. The count also tests the list: Pushpad's public list of
  known push services has `android.googleapis.com` and `jmt17.google.com`, which this pattern refuses.
  A skipped row never gets a 404 or 410, so it stays, and that device gets no reminders until Settings
  shows the toggle off (recommended, in the spec). How many people this reaches depends on the count.
- 2026-11-01 Open call 2: at the limit of 10, refuse the new subscription or replace the oldest?
  Recommended: replace the oldest, so a person on a new device is never told push failed. "Oldest"
  means least recently subscribed, not least recently used: nothing updates `last_seen_at` after the
  insert, so a phone in daily use can be the one replaced. The cost is more than one reminder: that
  phone gets none until someone opens Settings on it, and its toggle still shows on until then. The
  alternative is to reconcile on app start as well, which is more work and more reads, or to refuse
  at the limit. Ten live devices on one account should be rare, so the recommendation stands.
- 2026-11-01 Open call 3: are 20 at once, 15 seconds, 240 seconds and 300 seconds right for the
  number of live subscriptions and the Vercel plan? Recommended: keep them, after checking the row
  count from open call 1 and the plan's limit. The 300 is unproven: the only `maxDuration` in the
  repo today is 60, and the Vercel connector returned no plan and no project on 2 November 2026.
- 2026-11-02 Fraser's ruling on #2204: approved. Open call 1: the read-only count by host is done
  (ops #380: no row outside the list on either project), so the send-time skip and `NOT VALID` stand,
  with validation in ops #416. Open call 2: replace the least recently subscribed at 10 per account.
  Open call 3: keep 20, 15 seconds, 240 seconds and 300 seconds; Vercel Pro allows 300 seconds.
  Migration 049 may be applied to QA.
