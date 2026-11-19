## ADDED Requirements

### Requirement: A Worker Cron Trigger calls the routes every hour

The production Worker's `0 * * * *` Cron Trigger SHALL call `send-daily` and `send-nudge` at minute 0
of every UTC hour, through the Worker's own fetch handler, with an empty JSON body and
`CRON_SHARED_SECRET` as the bearer token. There SHALL be no `pg_cron` job, no Vault secret and no
`vercel.json` cron. The preview Worker SHALL have no Cron Triggers.

#### Scenario: Top of each hour

- **WHEN** the clock reaches minute 0 of any UTC hour
- **THEN** both routes are called and each applies its own per-user hour gate

#### Scenario: One route fails

- **WHEN** `send-daily` answers 502 in a firing
- **THEN** `send-nudge` still runs in that firing and both statuses are logged

#### Scenario: Preview Worker

- **WHEN** the hour turns on the preview Worker
- **THEN** neither route is called

Source (planned): design D2, `worker/index.ts`, `lib/cron/schedule.ts`, `wrangler.jsonc`.

## RENAMED Requirements

- FROM: `### Requirement: Cross-user reads go through service-role functions`
- TO: `### Requirement: Cross-user reads go through the system module`

## MODIFIED Requirements

### Requirement: Cron routes check a constant-time bearer secret
Both routes SHALL accept a caller only when the `Authorization` header equals `Bearer <CRON_SHARED_SECRET>`, compared in constant time, and SHALL otherwise answer 401 with an empty body. `CRON_SHARED_SECRET` SHALL be a Worker secret, and the Worker's scheduled handler SHALL send it. A missing header, an empty secret or a header of the wrong length SHALL be refused without throwing.

#### Scenario: Correct secret
- **WHEN** a request carries exactly `Bearer <secret>`
- **THEN** `isAuthorized` returns true (`lib/auth/bearerAuth.test.ts:7`)

#### Scenario: Wrong or missing header
- **WHEN** the header is missing, has the wrong secret, the wrong length, a lowercase `bearer` prefix or no prefix
- **THEN** `isAuthorized` returns false (`lib/auth/bearerAuth.test.ts:11-37`) and the route answers 401 with no body (`app/api/push/send-daily/route.test.tsx:413-436`)

#### Scenario: Multi-byte header
- **WHEN** the header holds multi-byte characters
- **THEN** the check returns false without throwing (`lib/auth/bearerAuth.test.ts:41`)

#### Scenario: Scheduled call
- **WHEN** the Worker's Cron Trigger calls a route
- **THEN** the call carries the secret and is accepted

Cites: `lib/auth/bearerAuth.ts:18-30`, planned `worker/index.ts`.

### Requirement: A route with missing configuration answers 503
Each route SHALL answer 503 `{ ok: false, error: "misconfigured" }` when the shared secret or the D1 binding is missing, or, where outbound sends are on (`DEPLOY_ENV` is `cloudflare-production`), a VAPID value is missing. This check SHALL run before the bearer check.

#### Scenario: Secret unset
- **WHEN** `CRON_SHARED_SECRET` is unset, or `VAPID_PRIVATE_KEY` is unset in production
- **THEN** the route answers 503

#### Scenario: Preview without a VAPID private key
- **WHEN** the preview Worker, which has no VAPID private key, is called with the right bearer
- **THEN** the route reads its targets, logs what it would have sent and answers 200 with zero sent

Cites: planned `app/api/push/send-daily/route.ts`, `app/api/push/send-streak-nudge/route.ts`, `lib/outbound.ts`.

### Requirement: Cross-user reads go through the system module
The routes SHALL read across users only through named functions in `lib/db/system.ts` (ports of `get_push_targets`, `get_push_due_cards`, `get_push_streak_days` and `get_push_streak_nudge_targets`), which only the cron, push-send, Discord and feedback routes may import. The targets read SHALL return one row per subscription, LEFT JOINed to the owner's settings. The only other access SHALL be the dead-endpoint DELETE.

#### Scenario: Route reads
- **WHEN** `send-daily` runs
- **THEN** it calls the targets and due-cards functions and runs no other query

#### Scenario: User with no settings row
- **WHEN** a subscription's owner has no `user_settings` row
- **THEN** the target row still comes back with null settings, and default eligibility applies

#### Scenario: Same answers as Postgres
- **WHEN** the system functions run against the D1 test database loaded like the Postgres RPC tests
- **THEN** they return the same rows

Cites: planned `lib/db/system.ts`; behaviour from `db/migrations/046_get_push_targets.sql`, `db/migrations/047_get_push_streak_nudge_targets.sql`.

### Requirement: A run that starts sending always finishes

Both routes SHALL export no `maxDuration`, since Workers ignore it and a Cron Trigger run may last 15
minutes. No new send SHALL start more than 240 seconds after the route started. Once sending has
started, the run SHALL still delete dead subscriptions and respond, and SHALL log how many due devices
it did not reach and how many rows it skipped. The reads before the first send have no limit of their
own.

#### Scenario: Budget used up

- **WHEN** 240 seconds have passed with devices left
- **THEN** those devices are not sent to and are counted in a log line, dead rows found so far are deleted and the route returns 200

#### Scenario: Budget includes the reads

- **WHEN** the reads before the send take 230 seconds
- **THEN** sends start for at most the remaining 10 seconds

#### Scenario: Reads use up the budget

- **WHEN** the reads before the send take 245 seconds and then return
- **THEN** no send starts, the due devices are counted in a log line and the route returns 200

### Requirement: Subscriptions are stored per user and endpoint
`push_subscriptions` SHALL hold one row per `(user_id, endpoint)` with `p256dh`, `auth_secret`,
`created_at` and `last_seen_at`. Browsers SHALL reach it only through the data gateway (session user
pinned; select, insert and delete, no update). A new row SHALL be on a known push host; D1 SHALL set
`last_seen_at` on insert only, and keep each user to at most 10 rows by deleting the least recently
subscribed.

#### Scenario: Another user's row
- **WHEN** a signed-in client reads, adds or deletes a row for a different user
- **THEN** the gateway refuses it or returns no rows

#### Scenario: Re-subscribing
- **WHEN** a device re-subscribes
- **THEN** its row is deleted and inserted again, with a new `created_at` and `last_seen_at`, and no other row is replaced (`lib/push/subscribe.ts:186-207`)

Cites: planned `db/d1/migrations/0001_schema.sql`, `lib/db/tables.ts`; `lib/push/subscribe.ts:186-207`, `app/api/push/resubscribe/route.ts:45-63`.

### Requirement: Signing out leaves subscriptions in place
Signing out and switching accounts SHALL NOT change `push_subscriptions` or the local subscription: `PushOptIn` SHALL be the only caller of `unsubscribeFromPush`. A device used by two accounts SHALL hold one row for each. Account deletion SHALL remove the user's rows in its D1 batch.

#### Scenario: Second account on one device
- **WHEN** a second account subscribes on the same device
- **THEN** the endpoint has one row per user, and the first row stays (`lib/push/subscribe.ts:103-108`; see ops #425)

#### Scenario: Account deleted
- **WHEN** a subscribed player deletes their account
- **THEN** their rows are gone and another account's row for the same endpoint stays

Cites: `lib/push/subscribe.ts:103-108`, `components/pwa/PushOptIn.tsx:152`, planned `lib/db/rpc/deleteAccount.ts`.

### Requirement: Subscribing stores this device's endpoint and keys
`subscribeToPush` SHALL stop with a named reason when push is unsupported, the VAPID key is missing or permission is not granted, SHALL reuse an existing PushManager subscription or create one with `userVisibleOnly`, and SHALL save the row by delete-then-insert on `(user_id, endpoint)` through the data client, because the gateway allows no update on that table. Delete or insert failure SHALL return `persist-failed`, and the local subscription SHALL stay.

#### Scenario: Turning reminders on
- **WHEN** the user turns the toggle on and permission is granted
- **THEN** `subscribeToPush` runs and the toggle shows on (`components/pwa/PushOptIn.test.tsx:156`)

#### Scenario: Failure
- **WHEN** the helper returns a failure reason
- **THEN** the card shows that reason and the toggle stays off (`components/pwa/PushOptIn.test.tsx:195`)

#### Scenario: Key conversion
- **WHEN** a base64url VAPID key is decoded
- **THEN** the bytes are the right length and round-trip (`components/pwa/subscribeHelpers.test.tsx:23-34`)

#### Scenario: Existing subscription after the move
- **WHEN** a device subscribed before the move turns reminders on again
- **THEN** it keeps working, because the VAPID key pair moved to Worker secrets unchanged

Cites: `lib/push/subscribe.ts:110-209`, planned `lib/db/client.ts`.

## REMOVED Requirements

### Requirement: Two hourly cron jobs call the routes

**Reason**: The `pg_cron` jobs, their Vault URLs and secret, and the CI notice when `pg_cron` is missing
all go with Supabase.

**Migration**: Replaced by "A Worker Cron Trigger calls the routes every hour"; the full schedule is
in `hosting-and-data`.
