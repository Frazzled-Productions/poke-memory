## Root cause

Both send routes await `webpush.sendNotification` for each device in a `for` loop
(`app/api/push/send-daily/route.ts`, `app/api/push/send-streak-nudge/route.ts`) with no options
argument, and neither declares `maxDuration`. `web-push` 3.6.7 only sets a timeout when one is passed
(`src/web-push-lib.js:222,355`). One unanswered request therefore blocks the loop, the devices after
it and the clean-up that follows.

Evidence, 1 November 2026:

- **Seen** (real `web-push` 3.6.7 against local TLS servers, watched for 3 seconds):

  | Server | Option | Result |
  |---|---|---|
  | Never replies | none | still pending |
  | Never replies | `timeout: 500` | rejected, `Socket timeout` |
  | Sends headers, then a byte every 200 ms | `timeout: 500` | still pending |
  | Healthy | `timeout: 500` | resolved, 201 |

- **Seen** (the real `send-daily` route with a mocked `sendNotification` whose first call never
  settles, two devices due, after 600 simulated seconds): one call made, response not returned.
  `expected "vi.fn()" to be called 2 times, but got 1 times`.
- **Inferred:** how this behaves on Vercel at the function limit. It was not run there.

The third row of the table is why the socket timeout alone is not the fix: Node's `timeout` measures
inactivity, so the overall limit has to sit outside the library.

## Decisions

**A shared helper.** `deliverPushes(targets, buildPayload)` in `lib/push/deliver.ts` owns timing,
concurrency and collecting the ids to delete, and returns `{ sent, deadIds, skipped }`. Routes keep
their own eligibility logic and delete step.

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

The client inserts through RLS directly (`lib/push/subscribe.ts:194`), so only the database covers
that path; `resubscribe` checks first to return a 400 rather than a 500.

**Limit of 10 in a trigger.** It takes a per-user advisory lock so parallel inserts cannot pass the
limit, then replaces the oldest row by `last_seen_at`. `subscribeToPush` and `resubscribe` delete the
matching row first, so re-subscribing an existing device never replaces another.

## Blast radius

**The fact it is safe because of:** a healthy send behaves exactly as today, because `timeout` is a
listed `web-push` option that only adds a socket timeout. Rung 4: the healthy row in the table above.

Risks:

- A real browser uses a host outside the list, so it cannot subscribe
  (`lib/push/subscribe.ts:194`). Likelihood unknown, cost: that person gets no reminders. Check: the
  count by host in open call 2.
- `VALIDATE CONSTRAINT` fails on old rows if run early. Check: same count; it stays out of this change.
- Fixtures on `push.example` fail against the constraint in integration tests. Certain, cheap: tasks
  3.3.
- Existing route tests assert on send order. Cleared in part: a pool of 20 starts sends in order, and
  no test asserts `sendNotification` arguments with `toHaveBeenCalledWith`.
- The routes run on fake `Date` in tests, and real `setTimeout`s stay pending. Handled by clearing the
  timer in the helper.
- Cache Components and `maxDuration`: cleared, `app/api/srs/optimize/route.ts:27` already sets it.
