## ADDED Requirements

### Requirement: Bug reports email the company mailbox from the feedback route

After storing a `bug` row, the feedback route SHALL send the bug-report email in the same Worker with
`ctx.waitUntil`, through Resend to the company mailbox (`lib/alertEmail.ts`), from the row's `id`,
`page`, `app_version`, `created_at` and `authenticated`, never `user_id`. A failed or skipped email
SHALL be logged and SHALL NOT change the route's answer. It SHALL go out only when outbound sends are
on, as `hosting-and-data` describes.

#### Scenario: Feature request

- **WHEN** a `feature` or `other` row is inserted
- **THEN** no email is sent

#### Scenario: Resend down

- **WHEN** Resend refuses the email, or the request fails, after a bug row is stored
- **THEN** the route still answers `{ ok: true }` and the row stays

#### Scenario: No Resend key

- **WHEN** `RESEND_API_KEY` is not set
- **THEN** the feedback row is kept, `feedback-alert: alert not sent: no RESEND_API_KEY` is logged and
  no HTTP call is made

#### Scenario: Preview version

- **WHEN** a bug report is sent on the preview Worker
- **THEN** the row is stored, the would-be email is logged and nothing reaches Resend

Source (planned): design D3 and D8, `app/api/feedback/route.ts`, `lib/feedback/alerts.ts`,
`lib/alertEmail.ts`; tests `app/api/feedback/route.test.tsx`, `lib/feedback/alerts.test.ts`.

### Requirement: Bug-report email content

The bug-report email SHALL have the subject "Poké Memory: new bug report" and a plain-text body with
the page, app version, authenticated (Yes or "No (guest)"), timestamp and the feedback row id, never
`user_id` or an email address. A null page or version SHALL show "(not provided)". It SHALL go to
hello@frazzledproductions.com from `RESEND_FROM`, the same sender and recipient as the operator
alerts.

#### Scenario: Guest report

- **WHEN** the report has `authenticated` false
- **THEN** the email shows "No (guest)" and holds no user id

#### Scenario: Missing page

- **WHEN** the report has no page
- **THEN** the email shows "Page: (not provided)"

Source (planned): design D8, `lib/feedback/alerts.ts`, `lib/alertEmail.ts`; tests `lib/feedback/alerts.test.ts`.

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
player's rows. Neither deletion sends anything.

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

### Requirement: Bug notification message preview (baseline)

The feedback route SHALL read the row's message through `lib/db/system.ts` and add a "Message
preview" to the email, cut to 500 characters plus "…" when longer. If the read fails or finds no row,
the preview SHALL be left out and the email still sent. The preview stays (the #1848 ruling, upheld
by the owner on 2 November 2026, and again for email on 20 November 2026).

#### Scenario: Long message

- **WHEN** the message is 501 characters
- **THEN** the preview is 500 characters followed by "…"

#### Scenario: Message fetch fails

- **WHEN** the read errors
- **THEN** the email is sent without the preview

Source (planned): `lib/feedback/alerts.ts`, `lib/db/system/feedback.ts`; tests
`lib/feedback/alerts.test.ts`.

### Requirement: Weekly feedback digest (baseline)

The Worker's schedule SHALL call `POST /api/cron/feedback-digest` on Mondays at 09:00 UTC. The route
SHALL answer 503 without `CRON_SHARED_SECRET` and 401 on a wrong bearer. `window_days` SHALL default
to 7 when absent or the body is unparseable, and a number SHALL be rounded and clamped to 1-90. The
email SHALL go out only when outbound sends are on; without `RESEND_API_KEY` it is logged and skipped
and the route answers 200 with `sent` false.

#### Scenario: Window too large

- **WHEN** `window_days` is 365
- **THEN** the window is 90 days

#### Scenario: Unparseable body

- **WHEN** the body is not JSON
- **THEN** the window is 7 days

#### Scenario: Preview Worker

- **WHEN** Monday 09:00 UTC passes on the preview Worker
- **THEN** no digest runs, because the preview has no Cron Triggers

Source (planned): `app/api/cron/feedback-digest/route.ts`, `lib/cron/schedule.ts`; tests
`app/api/cron/feedback-digest/route.test.tsx`.

### Requirement: Digest content (baseline)

The route SHALL count rows by category in the window, splitting authenticated from guest without
selecting `user_id`, and SHALL never select `message`. It SHALL email the window, the total and one
line per category with rows, as "Bug: 3 (2 auth, 1 guest)", with the subject "Poké Memory: weekly
feedback digest". A query error SHALL answer 502 `query_failed`; a Resend refusal or network error
SHALL answer 502 `email_failed`. Success answers with the total, window and `sent`.

#### Scenario: Empty week

- **WHEN** there is no feedback in the window
- **THEN** a digest showing a total of 0 is still emailed

#### Scenario: Category with no rows

- **WHEN** a category has no rows
- **THEN** it has no line in the email

Source (planned): `app/api/cron/feedback-digest/route.ts`, `lib/feedback/alerts.ts`; tests
`app/api/cron/feedback-digest/route.test.tsx`, `lib/feedback/alerts.test.ts`.

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

### Requirement: The privacy notice states the deletion

Notice section 3 SHALL say a bug report sends a notification email to the company mailbox through
Resend, with a preview of up to 500 characters and no user identifier, deleted 12 months after it
arrives. Section 6 SHALL list Resend in place of Discord, section 7 its transfer safeguards, and
section 8 SHALL say the email cannot be matched to an account, so deleting the account does not
remove it, but it never outlasts 12 months. The DPIA and the Children's Code assessment SHALL say
the same.

#### Scenario: Reading the notice

- **WHEN** anyone opens the privacy notice, in any locale
- **THEN** sections 3, 6 and 8 say the bug-report email is deleted 12 months after it arrives
- **AND** the notice does not mention Discord

Source (planned): `app/privacy/page.tsx`, `docs/dpia.md`, `docs/childrens-code-assessment.md`; tests
`app/privacy/page.test.tsx` "says a bug report is emailed to our company mailbox through Resend" and
"says how long the bug-report email is kept, in sections 3, 6 and 8".

## REMOVED Requirements

### Requirement: Bug reports notify Discord through the database (baseline)

**Reason**: The `feedback` insert trigger, `pg_net` and the Vault secrets go with Supabase, and
Discord goes for email (Fraser's ruling, 20 November 2026).

**Migration**: Replaced by "Bug reports email the company mailbox from the feedback route", which
sends the same fields and never `user_id`.

### Requirement: Bug notifications are deleted with their feedback

**Reason**: The `feedback` delete trigger and its Vault secrets go with Supabase, and an email cannot
be deleted from the Worker. Fraser's ruling of 20 November 2026 moved the notification to email.

**Migration**: The email holds no user id and is deleted from the mailbox 12 months after it
arrives, as "The privacy notice states the deletion" says. `feedback_discord_posts` is not copied to
D1, and D1 migration `0004` drops it.

### Requirement: Notify route guards (baseline)

**Reason**: `POST /api/discord/notify` is removed with Discord (20 November 2026). The feedback route
sends the email itself, so no bearer-guarded notify route is needed.

**Migration**: None; a bug-report email is sent only from the feedback route.

### Requirement: The notify route stores the Discord message id

**Reason**: Discord goes for email (20 November 2026); there is no message id to store.

**Migration**: None.

### Requirement: The notify route deletes the stored post

**Reason**: Discord goes for email (20 November 2026); the notify route and its delete event go.

**Migration**: None. The retry sweep for failed Discord deletions (#2369) is no longer needed.

### Requirement: Bug notification content (baseline)

**Reason**: The Discord embed goes with Discord (Fraser's ruling, 20 November 2026), and with it the
webhook failure answers of the notify route.

**Migration**: Replaced by "Bug-report email content", which carries the same fields; a failed send is
covered by "Bug reports email the company mailbox from the feedback route".
