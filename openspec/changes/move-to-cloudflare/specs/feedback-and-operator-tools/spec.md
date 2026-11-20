## ADDED Requirements

### Requirement: Bug reports notify Discord from the feedback route

After storing a `bug` row, the feedback route SHALL run the notify logic in the same Worker with
`ctx.waitUntil`, passing `id`, `category`, `page`, `app_version`, `created_at` and `authenticated`, and
never `message` or `user_id`. A failed or skipped notification SHALL be logged and SHALL NOT change the
route's answer. The post SHALL go out only when outbound sends are on, as `hosting-and-data` describes.

#### Scenario: Feature request

- **WHEN** a `feature` or `other` row is inserted
- **THEN** no notification is sent

#### Scenario: Discord down

- **WHEN** the webhook fails after a bug row is stored
- **THEN** the route still answers `{ ok: true }` and the row stays

#### Scenario: Webhook not configured

- **WHEN** `DISCORD_NOTIFY_WEBHOOK_URL` is not set
- **THEN** the feedback row is kept and no HTTP call is made

#### Scenario: Preview version

- **WHEN** a bug report is sent on the preview Worker
- **THEN** the row is stored, the would-be notification is logged and nothing reaches Discord

Source (planned): design D3, `app/api/feedback/route.ts`, `lib/discord/notify.ts`.

### Requirement: Deleting feedback deletes its bug notification

`feedback_discord_posts` SHALL hold only a feedback id, a Discord message id and a timestamp, with no
foreign key to `feedback`, and SHALL NOT be on the data gateway. When the retention job or an account
deletion removes a `bug` row with a stored message id, the Worker SHALL run the notify route's delete
logic for it with `ctx.waitUntil`, sending neither `message` nor `user_id`. A failed delete SHALL never
block the feedback delete.

#### Scenario: Purge removes an old bug report

- **WHEN** the daily purge deletes a bug report whose notification id is stored
- **THEN** the Discord message is deleted and its `feedback_discord_posts` row goes

#### Scenario: Account deletion

- **WHEN** a signed-in player deletes their account and their bug reports go with it
- **THEN** each one's Discord message is deleted the same way

#### Scenario: Guest report

- **WHEN** a guest's bug report reaches 12 months
- **THEN** its Discord message is deleted by the purge path

#### Scenario: Discord down at deletion

- **WHEN** the Discord delete fails
- **THEN** the feedback row is still deleted and the stored id stays for the retry sweep (#2369)

Source (planned): design D3, `app/api/cron/feedback-retention/route.ts`, `lib/db/rpc/deleteAccount.ts`,
`lib/discord/notify.ts`.

## MODIFIED Requirements

### Requirement: Feedback route input handling (baseline)

`POST /api/feedback` SHALL check configuration first, answering 500 `misconfigured` without its D1
binding. It SHALL answer 400 `invalid_json` for an unparseable body, 400 `invalid_category` for anything
but bug, feature or other, and 400 `missing_message` for a non-string or blank message. A body of
literal JSON `null` parses, then throws an unhandled `TypeError` at the category check, which looks
wrong (held in ops #442).

#### Scenario: Blank message

- **WHEN** the message is only whitespace
- **THEN** the route answers 400 `missing_message`

#### Scenario: Unknown category

- **WHEN** the category is `praise`
- **THEN** the route answers 400 `invalid_category`

#### Scenario: Body is literal null

- **WHEN** the body is the JSON value `null`
- **THEN** the handler throws before the rate limit and no row is inserted (ops #442)

Source (planned): `app/api/feedback/route.ts`, `lib/api/parseJsonBody.ts:19`; tests
`app/api/feedback/route.test.tsx`.

### Requirement: Feedback identity comes from the session (baseline)

The route SHALL take `user_id` only from the Better Auth session read from the request, ignoring any
`user_id` in the body. A guest, or a failure reading the session, SHALL insert a null `user_id` and
carry on.

#### Scenario: Spoofed id

- **WHEN** a guest sends `user_id` in the body
- **THEN** the row is inserted with `user_id` null

#### Scenario: Session read throws

- **WHEN** reading the session throws
- **THEN** the row is still inserted, with `user_id` null

Source (planned): `app/api/feedback/route.ts`, `lib/auth/server.ts`; tests
`app/api/feedback/route.test.tsx`.

### Requirement: Feedback rate limit (baseline)

After validation and identity, the route SHALL check the D1 rate-limit buckets with action `feedback`
and a salted hash of Cloudflare's `cf-connecting-ip` header, or of `unknown` without it. The caps are 5
in 10 minutes and 20 in an hour per hash. Only an explicit refusal SHALL answer 429 `rate_limited`. A
limiter error SHALL log a warning and let the insert go ahead.

#### Scenario: Over the cap

- **WHEN** the bucket check refuses the attempt
- **THEN** the route answers 429 and inserts nothing

#### Scenario: Limiter unavailable

- **WHEN** the bucket check errors
- **THEN** the insert goes ahead and the route answers 200

Source (planned): `app/api/feedback/route.ts`, `lib/auth/rateLimitIp.ts`, `lib/db/system.ts`.

### Requirement: Feedback storage and retention (baseline)

The route SHALL insert through `lib/db/system.ts` and answer `{ ok: true }`, or 500 `{ ok: false }` on an
insert error or throw. The `feedback` table SHALL NOT be on the data gateway, so no browser reads or
writes it. `user_id` is nullable. The Worker's schedule SHALL call `POST /api/cron/feedback-retention`
at 03:00 UTC daily, which SHALL delete rows older than 12 months. Account deletion SHALL delete the
player's rows. Either deletion SHALL also delete a bug report's Discord notification.

#### Scenario: Account deleted

- **WHEN** a player deletes their account
- **THEN** their feedback rows go with it, and guest rows wait for the purge

#### Scenario: Insert fails

- **WHEN** the insert returns an error
- **THEN** the route logs it and answers 500 `{ ok: false }`

#### Scenario: Retention without the secret

- **WHEN** anyone calls the retention route without the bearer secret
- **THEN** it answers 401 and deletes nothing

Source (planned): `app/api/feedback/route.ts`, `app/api/cron/feedback-retention/route.ts`,
`lib/db/system.ts`, `lib/db/tables.ts`.

### Requirement: Notify route guards (baseline)

`POST /api/discord/notify` SHALL answer 503 `misconfigured` without `CRON_SHARED_SECRET`,
`DISCORD_NOTIFY_WEBHOOK_URL` or its D1 binding; 401 with no body unless the bearer matches in constant
time; 400 `invalid_json` for an unparseable body; and 400 `forbidden_fields` if the body contains
`message` or `user_id`. It does not check the rest of the body's shape or its category.

#### Scenario: Wrong bearer

- **WHEN** the token is wrong or a different length
- **THEN** the route answers 401

#### Scenario: Malformed authorised body

- **WHEN** an authorised body is `null` or has no valid `created_at`
- **THEN** the handler throws (held in ops #442)

#### Scenario: Forbidden field

- **WHEN** the body contains `message`
- **THEN** the route answers 400 and nothing reaches Discord

Source (planned): `app/api/discord/notify/route.ts`, `lib/auth/bearerAuth.ts:18`; tests
`app/api/discord/notify/route.test.tsx`.

### Requirement: Bug notification content (baseline)

The notify logic SHALL post one red embed titled "New bug report" with page, app version,
authenticated (Yes or "No (guest)"), timestamp and the feedback row id, never `user_id`; the Supabase
dashboard link goes. A null page or version SHALL show "(not provided)". A failed webhook SHALL answer
502, `webhook_fetch_failed` for a network error and `webhook_error` with the status for a non-2xx.
Success answers `{ ok: true }`.

#### Scenario: Guest report

- **WHEN** the payload has `authenticated` false
- **THEN** the embed shows "No (guest)" and holds no user id

#### Scenario: Discord down

- **WHEN** the webhook answers non-2xx
- **THEN** the route answers 502 with that status, and the feedback row stays

Source (planned): `app/api/discord/notify/route.ts`, `lib/discord/notify.ts`; tests
`app/api/discord/notify/route.test.tsx`.

### Requirement: Bug notification message preview (baseline)

The notify logic SHALL read the row's message through `lib/db/system.ts` and add a "Message preview"
field, cut to 500 characters plus "…" when longer. If the read fails or finds no row, the preview SHALL
be left out and the embed still posted. The preview stays (the #1848 ruling, upheld by the owner on 2
November 2026) and is deleted with its feedback.

#### Scenario: Long message

- **WHEN** the message is 501 characters
- **THEN** the preview is 500 characters followed by "…"

#### Scenario: Message fetch fails

- **WHEN** the read errors
- **THEN** the embed posts without the preview field

Source (planned): `lib/discord/notify.ts`, `lib/db/system.ts`; tests
`app/api/discord/notify/route.test.tsx` "message preview (#1848)".

### Requirement: Weekly feedback digest (baseline)

The Worker's schedule SHALL call the digest route on Mondays at 09:00 UTC with `{"window_days":7}`. The
route SHALL answer 503 without `CRON_SHARED_SECRET`, its own `DISCORD_DIGEST_WEBHOOK_URL` or its D1
binding, and 401 on a wrong bearer. `window_days` SHALL default to 7 when absent or the body is
unparseable, and a number SHALL be rounded and clamped to 1-90. The post SHALL go out only when
outbound sends are on.

#### Scenario: Window too large

- **WHEN** `window_days` is 365
- **THEN** the window is 90 days, although the comment at the top of the route says it falls back to 7

#### Scenario: Unparseable body

- **WHEN** the body is not JSON
- **THEN** the window is 7 days

#### Scenario: Preview Worker

- **WHEN** Monday 09:00 UTC passes on the preview Worker
- **THEN** no digest runs, because the preview has no Cron Triggers

Source (planned): `app/api/discord/digest/route.ts`, `lib/cron/schedule.ts`; tests
`app/api/discord/digest/route.test.tsx`.

### Requirement: Sentry start-up in every runtime (baseline)

`register()` SHALL load the server initialiser by `NEXT_RUNTIME`, and the browser SHALL initialise in
`instrumentation-client.ts`. All SHALL read `NEXT_PUBLIC_SENTRY_DSN`, and with no DSN Sentry is a safe
no-op. Traces SHALL default to a 0.1 sample rate, overridable by env, and Session Replay SHALL stay at
0. The environment SHALL be `cloudflare-production` or `cloudflare-preview` from `DEPLOY_ENV`, falling
back to `NODE_ENV`; on the server `SENTRY_ENVIRONMENT` wins.

#### Scenario: No DSN

- **WHEN** `NEXT_PUBLIC_SENTRY_DSN` is unset
- **THEN** `Sentry.init` opens no connection and throws nothing

#### Scenario: Preview deployment

- **WHEN** `DEPLOY_ENV` is `cloudflare-preview`
- **THEN** the environment is `cloudflare-preview`

#### Scenario: Worker runtime

- **WHEN** the server initialiser runs on the Worker under `nodejs_compat`
- **THEN** errors reach Sentry with the same privacy scrubbing

Source (planned): `instrumentation.ts`, `instrumentation-client.ts`, `instrumentation-node.ts`,
`lib/observability/sentryPrivacy.ts`; tests `lib/observability/sentryPrivacy.test.ts`.

### Requirement: Test error page (baseline)

`/test-error` SHALL throw on render so the root error boundary shows, as a stable target for the
Playwright smoke tests. It is not linked from navigation and renders per request. When `DEPLOY_ENV` is
`cloudflare-production` it SHALL give a 404 instead.

#### Scenario: E2E run

- **WHEN** Playwright opens `/test-error` outside production, the preview Worker included
- **THEN** the error boundary shows with its Try again and Go to Practice controls

#### Scenario: Production

- **WHEN** a visitor opens `/test-error` in production
- **THEN** the not-found page shows

Source (planned): `app/test-error/page.tsx`; tests `e2e/error-boundary.spec.ts`.

### Requirement: The notify route stores the Discord message id

The notify logic, reached through the route or called by the feedback route, SHALL send the bug embed
with `wait=true`, keeping any query parameters already on the webhook URL, and SHALL store the message
id Discord returns in `feedback_discord_posts` against the feedback id. Failing to store it SHALL be
logged and SHALL NOT change the answer. If the row is gone once the id is stored, it SHALL delete the
post.

#### Scenario: Message id stored

- **WHEN** Discord accepts the post and returns a message id
- **THEN** one `feedback_discord_posts` row holds the feedback id and that message id

#### Scenario: Row deleted while the post was in flight

- **WHEN** the feedback row is gone by the time the message id is stored
- **THEN** the logic deletes that Discord post and its stored id

#### Scenario: Storing the id fails

- **WHEN** the insert into `feedback_discord_posts` errors, or Discord returns no id
- **THEN** the failure is logged and the answer is still 200

Source (planned): `lib/discord/notify.ts`, `app/api/discord/notify/route.ts`; tests
`app/api/discord/notify/route.test.tsx` "stores the Discord message id (ops #405)".

### Requirement: The notify route deletes the stored post

After the bearer and forbidden-field guards, a deletion event with an id SHALL delete the stored
Discord message, then the stored id; the retention job and account deletion run the same logic
in-process. Only 404 code 10008 SHALL count as deleted; a 429 SHALL be retried twice after
`retry_after`. Other failures SHALL answer 502 and keep the id. No id: 400; no stored id: 200 without
calling Discord; no D1 binding: 503.

#### Scenario: Discord down at deletion

- **WHEN** the webhook delete answers 500 or the request throws
- **THEN** the route answers 502 and the stored id stays

#### Scenario: Already gone

- **WHEN** Discord answers 404 with code 10008 (Unknown Message)
- **THEN** the stored id is removed and the route answers 200

#### Scenario: Webhook gone

- **WHEN** Discord answers 404 with code 10015 (Unknown Webhook)
- **THEN** the route answers 502 and the stored id stays

#### Scenario: Rate limited

- **WHEN** Discord answers 429 and then accepts the delete
- **THEN** the post and the stored id are deleted and the route answers 200

#### Scenario: Nothing stored

- **WHEN** a deletion event arrives for a row with no stored id
- **THEN** the route answers 200 without calling Discord

#### Scenario: Forbidden field on a deletion event

- **WHEN** a deletion body contains `user_id` or `message`
- **THEN** the route answers 400 and nothing reaches Discord

Source (planned): `app/api/discord/notify/route.ts`, `lib/discord/notify.ts`; tests
`app/api/discord/notify/route.test.tsx` "deletes the post with the feedback (ops #405)".

## REMOVED Requirements

### Requirement: Bug reports notify Discord through the database (baseline)

**Reason**: The `feedback` insert trigger, `pg_net` and the Vault secrets go with Supabase.

**Migration**: Replaced by "Bug reports notify Discord from the feedback route", which sends the same
fields and never `message` or `user_id`.

### Requirement: Bug notifications are deleted with their feedback

**Reason**: The `feedback` delete trigger and its Vault secrets go with Supabase.

**Migration**: Replaced by "Deleting feedback deletes its bug notification", which keeps the same
behaviour for the purge, account deletion and guest reports.
