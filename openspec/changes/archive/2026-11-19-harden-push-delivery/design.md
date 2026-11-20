## Root cause

Both send routes await `webpush.sendNotification` for each device in a `for` loop
(`app/api/push/send-daily/route.ts`, `app/api/push/send-streak-nudge/route.ts`) with no options
argument, and neither declares `maxDuration`. `web-push` 3.6.7 only sets a timeout when one is passed
(`src/web-push-lib.js:222,356`). One slow send therefore delays the loop, the devices after it and
the clean-up that follows.

Node's `timeout` measures inactivity, so a response that keeps arriving slowly outlasts it, and the
overall limit has to sit outside the library. Both were measured with the real `web-push` 3.6.7
against local TLS servers on 1 November 2026. How this behaves on Vercel at the function limit was
not run there.

## Decisions

**A shared helper.** `deliverPushes(targets, buildPayload, startedAt)` in `lib/push/deliver.ts` owns
timing, concurrency and collecting the ids to delete, and returns
`{ sent, deadIds, notReached, unknownHost }`. Routes keep their own eligibility logic and delete step.
A route filters to the devices that are due before it calls the helper, so `notReached` never counts
a device that was not going to be sent to. `buildPayload` runs inside the pool and inside the same
`try` as the send: a build that throws counts as a failed send for that device and cannot lose the
`deadIds` found so far. `startedAt` is the time `POST` started: the 240 seconds count from there,
because the reads before the send (`get_push_targets` and `fetchAllPages`) take part of the same 300
seconds and have no limit of their own. A read that hangs past 300 seconds still ends the function
with no response. Little is lost, because no sends have run, so this change leaves that alone.

**Overall limit with `Promise.race`.** `web-push` has no abort signal, so a send past 15 seconds is
abandoned and counted as a failure, and its timer is cleared when the send settles. An abandoned
socket ends with the function. A 15 second limit outside a 10 second socket timeout leaves the
library's own error as the usual outcome.

**A pool, not batches.** With fixed batches one slow send delays its whole batch; a pool of 20
workers takes the next device as soon as one is free. If every send hit the limit, a run would still
cover 320 devices in 240 seconds.

**Known hosts, in one list.** `lib/push/endpoints.ts` holds the pattern. The migration repeats it
because SQL cannot import it, and a parity test reads the migration text and fails if they differ.

```
^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/
```

The database constraint is the rule. `resubscribe` checks first to return a 400 rather than a 500.

**Limit of 10 in a trigger.** It takes a per-user advisory lock so parallel inserts cannot pass the
limit, then deletes that user's rows beyond the newest 9 by `last_seen_at`, then `id`, so an account
already over the limit comes down to 10 rather than staying there. It also sets
`NEW.last_seen_at := now()`, because `subscribeToPush` and `reconcileSubscription` send the browser's
clock (`lib/push/subscribe.ts:201,378`) and a wrong clock would otherwise decide which row goes. It
runs as the caller, not `SECURITY DEFINER`, so the delete stays inside RLS. `subscribeToPush`, `resubscribe` and
`reconcileSubscription` delete the matching row first, so re-subscribing an existing device never
replaces another. `last_seen_at` is only written at insert (the comment in migration 028 saying the
send route updates it is out of date), so it means "last subscribed". Tests that need a set order
insert first, then `UPDATE` `last_seen_at`, because the trigger overrides the value on insert.

Run in Postgres 15, 1 November 2026, with this pattern, a trigger of this shape and RLS: the pattern
gave the same answers as Node (4 accepted, 5 lookalikes refused); 20 parallel
inserts left 10 rows; 14 existing rows left 10 (a trigger that deletes only one row left 14); an
unknown host at the limit, and an insert for another user, each removed nothing, because the failed
insert rolls back the trigger's delete. `NOT VALID` kept the old row, but an `UPDATE` to that row was
refused. Nothing in the app updates this table. That run predates setting `last_seen_at` in the
trigger, so task 4.1's tests are the proof of that part.

## Blast radius

**The fact it is safe because of:** a send to a listed host that is answered within 10 seconds
behaves exactly as today, because `timeout` is a listed `web-push` option that only adds a socket
timeout. Rung 4: the real `web-push` 3.6.7 against local TLS servers, healthy with and without the
option, 201 both ways, the same request on the wire, and a 410 keeps its status.

Risks:

- A real browser uses a host outside the list, so it cannot subscribe
  (`lib/push/subscribe.ts:194`). It also loses any row it has when it re-subscribes, because the
  delete and insert are separate calls. Likelihood unknown, cost: that person gets no reminders.
  Check: the count by host in open call 1.
- A device on a host outside the list that already has a row is skipped at send time and never
  deleted, so without a fix it stays silent with its toggle on. Task 3.4 turns the toggle off when
  Settings is opened. Until then that person sees no sign. The per-run log line counts them.
- A row replaced at the limit stays gone until someone opens Settings on that device, and
  `PushOptIn` is the only caller of `reconcileSubscription`, so a phone in daily use gets no reminders
  until then, with its toggle on. Open call 2 carries this cost.
- More than 10 devices in real use: each visit to Settings replaces another device's row, so they
  take turns. Unlikely, cost as above. Accepted.
- A push service that accepts a message but stays silent past 10 seconds now counts as a failed send
  with no retry, although it received the message. Today that send succeeds. Seen with the real
  library at 1 second scale: option 1000 ms, server answers at 1200 ms, `Socket timeout`; the same
  server with no option, 201. Cost: `sent` is one low and a log line is wrong. The row stays. Accepted.
- `VALIDATE CONSTRAINT` fails on old rows if run early. Check: same count; it stays out of this
  change, in ops #416. Until that lands the send-time skip must stay.
- Fixtures on `push.example` fail against the constraint in integration tests, and
  `push.example.com` fixtures fail the `resubscribe` check. Certain, cheap: tasks 3.3.
- Existing route tests assert on send order. Cleared in part: a pool of 20 starts sends in order, and
  no test asserts `sendNotification` arguments with `toHaveBeenCalledWith`.
- Both route test files call `vi.useFakeTimers()` with no options, so `setTimeout` and `Date` are both
  fake: the limits only fire when a test advances the clock. Clearing the timer in the helper keeps
  healthy tests free of pending timers.
- Cache Components and `maxDuration`: the two work together, `app/api/srs/optimize/route.ts:27`
  already sets it, at 60. The 300 here has never run on this project, and it is what the budget of
  240 assumes. Check: the plan limit in open call 3, before the build.
