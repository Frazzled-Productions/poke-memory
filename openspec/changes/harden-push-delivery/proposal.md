## Why

Daily reminders and streak nudges go out from one hourly run that sends to each device in turn. A
send has no time limit, so one push service that is slow to answer holds up every device after it,
and the run can end before it clears dead subscriptions. Reminders should reach people on time
whatever one push service does. Refs ops #380 (held privately in Frazzled-Productions/ops).

## What Changes

- **Every send has a hard time limit.** A shared helper, `lib/push/deliver.ts`, gives each send a
  10 second socket timeout and a 15 second overall limit. Both are needed: the library's timeout only
  covers silence, so a response that keeps arriving slowly outlasts it (proven, see design.md).
- **One slow send cannot hold up the others.** The helper sends through a pool of at most 20 at
  once, in the existing order. `send-daily` and `send-streak-nudge` both use it and stop duplicating
  the send and clean-up loop.
- **A run always finishes.** Both routes set `maxDuration = 300`. The helper starts no new send after
  240 seconds, so dead subscriptions are still cleared and the route still responds. Devices not
  reached are counted in a log line.
- **Subscriptions must point at a known push service.** Apple, Google, Mozilla and Microsoft hosts
  only, checked in `resubscribe`, at send time and by a database constraint. The next migration adds
  the constraint as `NOT VALID`; validating it waits for the check of existing rows (open call 2).
- **At most 10 subscriptions per account**, enforced in the database (open call 3).

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change, none
  of them read `push_subscriptions` or call the send routes.
- **Settings:** no new UI. `PushOptIn` already shows the failure state from `subscribeToPush`
  (`persist-failed`), which a browser using an unknown push service would now reach.
- **Guest mode (localStorage):** no change, push is signed-in only (`lib/push/subscribe.ts:6`).
- **Cloud sync and Supabase migrations (both projects):** one new migration, next free number after
  048, on `push_subscriptions` only: a `NOT VALID` check and a `BEFORE INSERT` trigger. Sync does not
  touch this table.
- **Superuser mode and QA-seed scenarios:** no change, the send routes run on the server from cron
  and the write guard is client-side.
- **Locales:** no new copy. Reminder text is unchanged in en, ja, zh-Hans, zh-Hant and the
  pseudo-locale.
- **Push notifications and the service worker (offline):** the two send routes and `resubscribe`
  change. `app/sw.ts` does not. Its `pushsubscriptionchange` handler posts to `resubscribe` and now
  gets a 400 for an unknown push service. Devices may receive a reminder in a different order within
  the hour.
- **Sign-in:** no change.
- **Privacy notice and sub-processors:** no change, same data and same push services.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `fixed` fragment, worded like this proposal. Release
  needs the migration on both projects.
- **CI and GitHub Actions:** no workflow change. Fixtures that use `https://push.example/...` against
  a real database must move to an allowed host: `lib/sync/integration/push-targets-rpc.test.ts:123`,
  and `e2e/settings.spec.ts:596` if its insert reaches the database. The send route tests mock the database
  but use the same host, so their fixtures move too, because the send-time check would skip them.

## Removes

- The two copies of the send and clean-up loop in `send-daily` and `send-streak-nudge`.
- The stale "cron is once per day" comment in `send-daily/route.ts`, which migration 031 made wrong.

## Out of scope

- The other findings in the same audit (ops #378).
- Retrying devices a run did not reach. They get the next run's reminder.
- Moving sends to a queue.
- Grouping or de-duplicating a user's devices.

## Owner decisions relied on

- 2026-10-21: every change goes through OpenSpec, bug fixes included, with spec on touch.
- 2026-10-22: never archive by hand.

## Clarifications

No grilling yet: this proposal was drafted by a scheduled run, so every call below is open for Fraser.
Each has a recommended answer, which the documents assume.

- 2026-11-01 Open call 1: how much of the reason goes in this public PR? Recommended: this wording,
  reliability only, with the detail staying in ops #380.
- 2026-11-01 Open call 2: what happens to existing rows on a host outside the list? Recommended: run
  a read-only count by host on both projects first, skip those rows at send time, then delete them
  and validate the constraint in a follow-up.
- 2026-11-01 Open call 3: at the limit of 10, refuse the new subscription or replace the oldest?
  Recommended: replace the oldest, so a person on a new device is never told push failed.
- 2026-11-01 Open call 4: are 20 at once, 15 seconds, 240 seconds and 300 seconds right for the
  number of live subscriptions and the Vercel plan? Recommended: keep them, after checking the row
  count from open call 2 and the plan's limit.
