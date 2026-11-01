## Purpose

Push delivery sends daily review reminders and streak nudges to the devices people have subscribed.
This baseline records current behaviour on `qa` and change harden-push-delivery (ops #380) adds time
limits, concurrency and limits on what can be subscribed. Requirements marked baseline describe the
code as it stands.

## ADDED Requirements

### Requirement: Reminders reach users at their hour (baseline, current behaviour)

The send routes SHALL only accept a caller with the shared cron secret. `send-daily` SHALL notify a
device only when its owner's effective hour matches the current UTC hour and something is due.
`send-streak-nudge` SHALL notify a device only when it is 20:00 for its owner, at least 3 hours from
their daily reminder, and their streak is at risk.

#### Scenario: Wrong hour

- **WHEN** `send-daily` fires at an hour that is not the owner's hour
- **THEN** nothing is sent to that device

#### Scenario: Nudge too close to the reminder

- **WHEN** `send-streak-nudge` fires at 20:00 local for an owner whose daily reminder is within 3 hours
- **THEN** nothing is sent to that device

#### Scenario: Missing secret

- **WHEN** a caller has no valid bearer secret
- **THEN** the route returns 401

<!-- source: app/api/push/send-daily/route.ts:660-664; app/api/push/send-streak-nudge/route.ts:249-266; lib/push/notificationHour.ts; app/api/push/send-daily/route.test.tsx "set hour" -->

### Requirement: Dead subscriptions are removed (baseline, current behaviour)

A subscription whose send returns 404 or 410 SHALL be deleted in the same run. Any other failed send
SHALL be logged and SHALL NOT stop the run.

#### Scenario: Gone

- **WHEN** a send returns 410
- **THEN** that row is deleted and the response counts it in `deleted`

#### Scenario: Server error from a push service

- **WHEN** a send returns 500
- **THEN** the row stays and the other devices are still sent to

<!-- source: app/api/push/send-daily/route.ts:799-845; app/api/push/send-streak-nudge/route.ts:347-376 -->

### Requirement: Re-subscribing replaces the row (baseline, current behaviour)

Subscribing or resubscribing SHALL delete the row for that user and endpoint, then insert it. The
`resubscribe` route SHALL return 401 to a caller with no session and 400 for a missing field.

#### Scenario: Rotated subscription

- **WHEN** a signed-in device posts its subscription again
- **THEN** one row exists for that user and endpoint

<!-- source: app/api/push/resubscribe/route.ts:27-63; lib/push/subscribe.ts:186-203 -->

### Requirement: Every send is time limited

Each send SHALL have a socket timeout of 10 seconds and an overall limit of 15 seconds. A send past
either limit SHALL count as a failed send, logged with the subscription id, and its row SHALL stay.

#### Scenario: No reply

- **WHEN** a push service accepts the request and never replies
- **THEN** the send fails within 15 seconds and the run goes on

#### Scenario: Slow reply

- **WHEN** a push service keeps sending a little data and never finishes
- **THEN** the send fails at 15 seconds, although the socket was never idle

#### Scenario: Healthy reply

- **WHEN** a push service answers 201 within the limit
- **THEN** the send counts in `sent`

### Requirement: One send cannot delay the others

Both routes SHALL send through one shared helper, with at most 20 sends in flight, and SHALL start
the next device as soon as a send ends.

#### Scenario: First device hangs

- **WHEN** the first of 21 devices never settles
- **THEN** the other 20 are all sent to before the first reaches its limit

#### Scenario: Limit on sends in flight

- **WHEN** 100 devices are due
- **THEN** no more than 20 sends are in flight at any moment

### Requirement: A run always finishes

Both routes SHALL declare `maxDuration = 300`. No new send SHALL start more than 240 seconds after
the route started. The run SHALL still delete dead subscriptions and respond, and SHALL log how many
devices it did not reach.

#### Scenario: Budget used up

- **WHEN** 240 seconds have passed with devices left
- **THEN** those devices are not sent to and are counted in a log line, dead rows found so far are deleted and the route returns 200

#### Scenario: Budget includes the reads

- **WHEN** the reads before the send take 230 seconds
- **THEN** sends start for at most the remaining 10 seconds

### Requirement: Subscriptions point at a known push service

An endpoint SHALL be https on an Apple, Google (FCM), Mozilla or Microsoft push host. The
`resubscribe` route SHALL return 400 `invalid_payload` for any other endpoint, the database SHALL
refuse a new row with one, and the send path SHALL skip an existing row with one.

#### Scenario: Known hosts

- **WHEN** the endpoint is on `web.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com` or `wns2-par02p.notify.windows.com`
- **THEN** it is accepted

#### Scenario: Unknown host

- **WHEN** a row is written with an endpoint on another host
- **THEN** no row is added

#### Scenario: Lookalike endpoint

- **WHEN** the endpoint is `http://fcm.googleapis.com/x`, `https://fcm.googleapis.com.example.com/x`, `https://fcm.googleapis.com@example.com/x` or `https://fcm.googleapis.com:8443/x`
- **THEN** it is refused

#### Scenario: Row from before the check

- **WHEN** an existing row has an unknown host at send time
- **THEN** it is skipped, not sent to, and not deleted

#### Scenario: One list

- **WHEN** the pattern in `lib/push/endpoints.ts` differs from the migration
- **THEN** the parity test fails

### Requirement: An account has at most 10 subscriptions

Inserting a row for a user who already has 10 or more SHALL first delete that user's rows with the
oldest `last_seen_at` until 9 remain, including when inserts run in parallel.

#### Scenario: New device at the limit

- **WHEN** a user with 10 rows subscribes on a new device
- **THEN** the insert succeeds, the oldest row is gone and the user has 10 rows

#### Scenario: Parallel inserts

- **WHEN** 20 inserts for one user run at once
- **THEN** the user ends with 10 rows

#### Scenario: Account already over the limit

- **WHEN** a user with 14 rows subscribes on a new device
- **THEN** the user has 10 rows, the newest among them

#### Scenario: Other users

- **WHEN** a user reaches the limit
- **THEN** no other user's rows change

#### Scenario: Existing device re-subscribes at the limit

- **WHEN** a user with 10 rows re-subscribes a device that already has a row
- **THEN** no other row is replaced
