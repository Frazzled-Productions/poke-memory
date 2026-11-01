## Purpose

Feedback notifications tell the maintainer that feedback has arrived, without moving the feedback
itself out of Supabase. This baseline records current behaviour on `qa`, and change
discord-bug-notification-no-text (ops #405) removes the message preview added in #1848. Requirements
marked baseline describe the code as it stands.

## ADDED Requirements

### Requirement: A bug report notifies the maintainer (baseline, current behaviour)

A new feedback row with category `bug` SHALL cause one Discord embed holding page, app version,
signed-in state, timestamp and a link to the row. Only a caller with the shared cron secret SHALL
reach the route. Other categories SHALL send no notification.

#### Scenario: Bug report

- **WHEN** a bug report is saved
- **THEN** one embed is posted to the webhook and the route returns 200

#### Scenario: Guest report

- **WHEN** the report came from a guest
- **THEN** the embed shows "No (guest)" for Authenticated

#### Scenario: No page stated

- **WHEN** the report has no page
- **THEN** the embed shows "(not provided)"

#### Scenario: Missing secret

- **WHEN** a caller has no valid bearer secret
- **THEN** the route returns 401 and posts nothing

#### Scenario: Webhook failure

- **WHEN** the webhook returns a non-2xx status or the request throws
- **THEN** the route returns 502

<!-- source: db/migrations/042_feedback_discord_notify.sql; app/api/discord/notify/route.ts; app/api/discord/notify/route.test.tsx -->

### Requirement: The trigger payload never holds the message or the user (baseline, current behaviour)

The route SHALL refuse a body containing `message` or `user_id` with 400 and post nothing. No
notification SHALL include a user identifier.

#### Scenario: Forbidden field

- **WHEN** the body contains `message` or `user_id`
- **THEN** the route returns 400 with `forbidden_fields` and the webhook is not called

<!-- source: app/api/discord/notify/route.ts; app/api/discord/notify/route.test.tsx "forbidden field" and "NO user_id field" -->

### Requirement: The weekly digest holds counts only (baseline, current behaviour)

The weekly digest SHALL report counts by category and SHALL NOT include any message or user
identifier.

#### Scenario: Populated week

- **WHEN** the digest runs for a week with feedback
- **THEN** the embed holds counts and no message text

<!-- source: app/api/discord/digest/route.ts; app/api/discord/digest/route.test.tsx "CRITICAL" -->

### Requirement: Feedback is deleted on schedule and with the account (baseline, current behaviour)

A feedback row SHALL be deleted 12 months after `created_at`. A row linked to an account SHALL be
deleted when the account is deleted.

#### Scenario: Old row

- **WHEN** the daily purge runs and a row is over 12 months old
- **THEN** the row is deleted

#### Scenario: Account deletion

- **WHEN** a signed-in user deletes their account
- **THEN** their feedback rows are deleted

<!-- source: db/migrations/034_feedback.sql:17,56 -->

### Requirement: Notifications carry no message text

A bug notification SHALL NOT contain any part of the feedback message, and the route SHALL NOT read
the `feedback` table or open a Supabase client. It SHALL post its embed whether or not a Supabase key
is set.

#### Scenario: Report with a message

- **WHEN** a bug report with a message is saved
- **THEN** the webhook body holds none of the message and the embed fields are exactly Page, App
  version, Authenticated, Timestamp and View in Supabase

#### Scenario: Row later deleted

- **WHEN** the purge or an account deletion removes the row
- **THEN** no text from that row remains in a notification sent after this change

#### Scenario: No Supabase key

- **WHEN** neither Supabase secret key is set
- **THEN** the route still posts the embed and returns 200

### Requirement: The privacy notice matches the notification

Notice sections 3 and 6 SHALL say that no message text goes to Discord, section 3 SHALL say the
notification stays in the channel after the feedback is deleted, and section 8 SHALL say these
notifications are not deleted automatically. The DPIA and Children's Code
assessment SHALL describe the same flow.

#### Scenario: Reading the notice

- **WHEN** anyone opens the privacy notice, in any locale
- **THEN** it holds no mention of a capped preview and says the notification contains none of the
  message
