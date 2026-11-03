## ADDED Requirements

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

#### Scenario: Payload build fails

- **WHEN** building the message for one device throws
- **THEN** that device counts as a failed send, the others are still sent to and dead rows found so far are deleted

### Requirement: A run that starts sending always finishes

Both routes SHALL declare `maxDuration = 300`. No new send SHALL start more than 240 seconds after
the route started. Once sending has started, the run SHALL still delete dead subscriptions and
respond, and SHALL log how many due devices it did not reach and how many rows it skipped. The reads
before the first send have no limit of their own.

#### Scenario: Budget used up

- **WHEN** 240 seconds have passed with devices left
- **THEN** those devices are not sent to and are counted in a log line, dead rows found so far are deleted and the route returns 200

#### Scenario: Budget includes the reads

- **WHEN** the reads before the send take 230 seconds
- **THEN** sends start for at most the remaining 10 seconds

#### Scenario: Reads use up the budget

- **WHEN** the reads before the send take 245 seconds and then return
- **THEN** no send starts, the due devices are counted in a log line and the route returns 200

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
- **THEN** it is skipped, not sent to, not deleted, and counted in a log line

#### Scenario: New subscription refused

- **WHEN** a browser on an unknown host turns the toggle on
- **THEN** `PushOptIn` shows the existing `persist-failed` state and the toggle stays off

#### Scenario: One list

- **WHEN** the pattern in `lib/push/endpoints.ts` differs from the migration
- **THEN** the parity test fails

### Requirement: An account has at most 10 subscriptions

Inserting a row for a user who already has 10 or more SHALL first delete that user's rows with the
oldest `last_seen_at` until 9 remain, including when inserts run in parallel. The database SHALL set
`last_seen_at` to its own time on insert, whatever the client sends, and the migration SHALL bring a
future `last_seen_at` on an existing row back to its own time.

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

#### Scenario: Wrong device clock

- **WHEN** a device with a clock a year slow subscribes as a user's newest row
- **THEN** its `last_seen_at` is the database's time and the next insert does not replace it first

#### Scenario: Device clock ahead before the limit

- **WHEN** a row written before the limit existed has a `last_seen_at` in the future
- **THEN** the migration sets it to the database's time, so that row can be replaced like any other

## MODIFIED Requirements

### Requirement: Opening Settings reconciles the local subscription
When Settings loads with a local subscription, `reconcileSubscription` SHALL first check its endpoint against the known push hosts. On an unknown host it SHALL delete the signed-in user's row for that endpoint, ignoring a failure, and the toggle SHALL show off, with or without a row, because the send path skips that row. Otherwise it SHALL look for the signed-in user's row for that endpoint. A matching row, or a failed query, SHALL show the toggle on. With no row it SHALL re-insert one from the local keys, for whichever account is signed in, superuser flags on or off; at the limit of 10 that insert replaces the user's least recently subscribed other row. If the re-insert fails or the keys are missing, the toggle SHALL show off. With no local subscription, the toggle SHALL show off without a server check. There is no reconcile outside Settings.

#### Scenario: Row present
- **WHEN** a matching row exists
- **THEN** the result is `in-sync` (`components/pwa/subscribeHelpers.test.tsx:133`)

#### Scenario: Row gone
- **WHEN** no row exists and the re-insert works
- **THEN** the result is `re-inserted` and the toggle shows on (`components/pwa/subscribeHelpers.test.tsx:141`, `components/pwa/PushOptIn.test.tsx:251`)

#### Scenario: Unknown host in Settings
- **WHEN** Settings opens on a device whose subscription is on an unknown host and a row exists
- **THEN** the row is deleted, nothing is inserted and the toggle shows off, not on (`components/pwa/subscribeHelpers.test.tsx:149-175`, `components/pwa/PushOptIn.test.tsx:261`)

#### Scenario: Replaced device opens Settings
- **WHEN** a device's row was replaced at the limit and Settings opens on it
- **THEN** the row is inserted again and the toggle stays on (`components/pwa/subscribeHelpers.test.tsx:177`)

#### Scenario: More than 10 devices take turns
- **WHEN** a user has 11 devices and Settings opens on the one with no row
- **THEN** its row is inserted, the oldest other row is replaced and the user has 10 rows (`lib/sync/integration/push-subscription-limits.test.ts`)

#### Scenario: Re-insert fails
- **WHEN** the re-insert fails
- **THEN** the result is `disabled` and the toggle shows off (`components/pwa/subscribeHelpers.test.tsx:185`, `components/pwa/PushOptIn.test.tsx:297`)

#### Scenario: Query error
- **WHEN** the SELECT errors
- **THEN** the result is `in-sync`, so the toggle is not falsely turned off (`components/pwa/subscribeHelpers.test.tsx:196`)

#### Scenario: No VAPID key in the build
- **WHEN** a local subscription exists and the VAPID key is missing
- **THEN** the result is `no-local`, no server check runs and the toggle shows on, as only `disabled` turns it off (`components/pwa/subscribeHelpers.test.tsx:206`, `components/pwa/PushOptIn.tsx:107`)

#### Scenario: Reminders turned off on another device
- **WHEN** reminders were turned off elsewhere, and Settings opens on a device still holding a local subscription on a known host
- **THEN** that device's row is re-inserted (see ops #424)

Cites: `lib/push/subscribe.ts:317-404`, `components/pwa/PushOptIn.tsx:81-110`.

### Requirement: The resubscribe route replaces a rotated subscription
`POST /api/push/resubscribe` SHALL parse the JSON body, answer 400 `invalid_json` or `invalid_payload` unless `endpoint` is a string on a known push host and `p256dh` and `auth` are non-empty strings, then require a session (401 `unauthorized`), delete the caller's row for that endpoint and insert the new one. Failures SHALL answer 500 `delete_failed` or `insert_failed`. It SHALL NOT remove the row for the previous endpoint.

#### Scenario: Signed out
- **WHEN** a valid body arrives with no session
- **THEN** the route answers 401 (`app/api/push/resubscribe/route.test.tsx:83`)

#### Scenario: Bad body
- **WHEN** the body is not JSON, a field is missing or `endpoint` is empty
- **THEN** the route answers 400 (`app/api/push/resubscribe/route.test.tsx:91-108`)

#### Scenario: Unknown host
- **WHEN** the endpoint is on a host outside the known list
- **THEN** the route answers 400 `invalid_payload` and writes nothing (`app/api/push/resubscribe/route.test.tsx:164`)

#### Scenario: Success
- **WHEN** the caller is signed in and the body is valid
- **THEN** the delete and insert run and the route answers 200 (`app/api/push/resubscribe/route.test.tsx:114`)

#### Scenario: Database failure
- **WHEN** the delete or the insert fails
- **THEN** the route answers 500 (`app/api/push/resubscribe/route.test.tsx:136-149`)

Cites: `app/api/push/resubscribe/route.ts:23-69`, `lib/push/endpoints.ts`, `lib/auth/requireAuth.ts:33-35`, `lib/api/parseJsonBody.ts:26-27`.

### Requirement: Subscriptions are stored per user and endpoint
`push_subscriptions` SHALL hold one row per `(user_id, endpoint)` with the endpoint, `p256dh`, `auth_secret`, `created_at` and `last_seen_at`, under row-level security with SELECT, INSERT and DELETE policies for the owner and no UPDATE policy. A new row SHALL have an endpoint on a known push host. The database SHALL set `last_seen_at` on insert and nothing SHALL update it afterwards. An insert SHALL keep the user to at most 10 rows by deleting their least recently subscribed rows.

#### Scenario: Another user's row
- **WHEN** a signed-in client reads, adds or deletes a row for a different user
- **THEN** the policies refuse it (`db/migrations/028_web_push_subscriptions.sql:98-105`)

#### Scenario: Re-subscribing
- **WHEN** a device re-subscribes
- **THEN** its row is deleted and inserted again, with a new `created_at` and `last_seen_at`, and no other row is replaced (`lib/push/subscribe.ts:186-207`)

Cites: `db/migrations/028_web_push_subscriptions.sql:78-105`, `db/migrations/049_push_subscriptions_limits.sql`, `lib/push/subscribe.ts:186-207`, `app/api/push/resubscribe/route.ts:45-63`.

### Requirement: Dead subscriptions are deleted and other send failures skipped
On a 404 or 410 from a push service each route SHALL delete that row once `deliverPushes` returns. Any other send failure, a send past its time limit included, SHALL be logged with the subscription id and status, its row SHALL stay, and the run SHALL carry on. A row on an unknown host SHALL be skipped and kept. A failed DELETE SHALL still answer 200, reporting `deleted: 0`. The response SHALL be `{ ok: true, sent, deleted }`.

#### Scenario: Gone
- **WHEN** a send returns 410 or 404
- **THEN** the row is deleted (`app/api/push/send-daily/route.test.tsx:651`, `:2043`, `app/api/push/send-streak-nudge/route.test.tsx:676`)

#### Scenario: Server error
- **WHEN** a send returns 500
- **THEN** the row stays and the other devices are still sent to (`app/api/push/send-daily/route.test.tsx:702`, `:2056`, `app/api/push/send-streak-nudge/route.test.tsx:697`, `:750`)

Cites: `lib/push/deliver.ts`, `send-daily:781-798`, `send-nudge:353-368`.
