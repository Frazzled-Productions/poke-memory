## MODIFIED Requirements

### Requirement: Feedback storage and retention (baseline)

The route SHALL insert through the service-role client and answer `{ ok: true }`, or 500 `{ ok: false }`
on an insert error or throw. The `feedback` table SHALL have RLS on and a deny-all SELECT policy, so
no client reads or writes it. `user_id` is nullable with `ON DELETE CASCADE`. A daily pg_cron job at
03:00 UTC SHALL delete rows older than 12 months. Either deletion SHALL also delete a bug report's
Discord notification.

#### Scenario: Account deleted

- **WHEN** a player deletes their account
- **THEN** their feedback rows go with it, and guest rows wait for the purge

#### Scenario: Insert fails

- **WHEN** the insert returns an error
- **THEN** the route logs it and answers 500 `{ ok: false }`

Source: `app/api/feedback/route.ts:124`, `app/api/feedback/route.ts:137`, `app/api/feedback/route.ts:146`, `db/migrations/034_feedback.sql:17`, `db/migrations/034_feedback.sql:29`, `db/migrations/034_feedback.sql:53`, `db/migrations/040_security_audit.sql:61`, `app/api/feedback/route.test.tsx:351`, `app/api/feedback/route.test.tsx:365`.

### Requirement: Bug notification message preview (baseline)

The route SHALL fetch the row's message with the service-role client and add a "Message preview" field, cut
to 500 characters plus "…" when longer. If the secret key is missing, or the fetch fails or finds no row,
the preview SHALL be left out and the embed still posted. The preview stays (the #1848 ruling, upheld
by the owner on 2 November 2026) and is deleted with its feedback.

#### Scenario: Long message

- **WHEN** the message is 501 characters
- **THEN** the preview is 500 characters followed by "…"

#### Scenario: Message fetch fails

- **WHEN** the query errors
- **THEN** the embed posts without the preview field

Source: `app/api/discord/notify/route.ts`, `app/api/discord/notify/route.test.tsx` "message preview (#1848)".

## ADDED Requirements

### Requirement: The notify route stores the Discord message id

The route SHALL send the bug embed with `wait=true`, keeping any query parameters already on the
webhook URL, and when a Supabase key is set SHALL store the message id Discord returns in
`feedback_discord_posts` against the feedback id. Failing to store it SHALL be logged and SHALL NOT
change the answer. If the row is gone once the id is stored, the route SHALL delete the post.

#### Scenario: Message id stored

- **WHEN** Discord accepts the post and returns a message id
- **THEN** one `feedback_discord_posts` row holds the feedback id and that message id

#### Scenario: Row deleted while the post was in flight

- **WHEN** the feedback row is gone by the time the message id is stored
- **THEN** the route deletes that Discord post and its stored id

#### Scenario: Storing the id fails

- **WHEN** the insert into `feedback_discord_posts` errors, or Discord returns no id
- **THEN** the route logs it and still answers 200

Source: `app/api/discord/notify/route.ts`, `app/api/discord/notify/route.test.tsx` "posts to the Discord webhook URL with wait=true" and "stores the Discord message id (ops #405)".

### Requirement: Bug notifications are deleted with their feedback

`feedback_discord_posts` SHALL hold only a feedback id, a Discord message id and a timestamp, with RLS
on, a deny-all SELECT policy and no foreign key to `feedback`. An AFTER DELETE trigger on `feedback`
SHALL fire for `category = 'bug'` rows that have a stored message id and POST `{ "event": "deleted",
"id" }` to the notify route with the shared bearer, both read from Vault. It SHALL never send `message`
or `user_id`, and a missing secret or failed post SHALL never block the delete.

#### Scenario: Purge removes an old bug report

- **WHEN** the daily purge deletes a bug report whose notification id is stored
- **THEN** the Discord message is deleted and its `feedback_discord_posts` row goes

#### Scenario: Account deletion

- **WHEN** a signed-in player deletes their account and the cascade removes their bug reports
- **THEN** each one's Discord message is deleted the same way

#### Scenario: Guest report

- **WHEN** a guest's bug report reaches 12 months
- **THEN** its Discord message is deleted by the purge path

#### Scenario: Vault secret missing

- **WHEN** `discord_notify_url` or `cron_shared_secret` is not set
- **THEN** the feedback row is still deleted and no HTTP call is made

Source: `db/migrations/051_feedback_discord_posts.sql`.

### Requirement: The notify route deletes the stored post

After the bearer and forbidden-field guards, a deletion event with an id SHALL delete the stored
Discord message, then the stored id. Only 404 code 10008 SHALL count as deleted; a 429 SHALL be retried
twice after `retry_after`. Other failures SHALL answer 502 and keep the id. No id: 400; no stored id:
200 without calling Discord; no Supabase key: 503.

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

Source: `app/api/discord/notify/route.ts`, `app/api/discord/notify/route.test.tsx` "deletes the post with the feedback (ops #405)".

### Requirement: The privacy notice states the deletion

Notice section 3 SHALL say the Discord notification is deleted when the feedback is deleted, section 6
SHALL say the same in the Discord row, and section 8 SHALL say a bug report's Discord notification,
message preview included, is deleted after 12 months or with the account. The DPIA and the Children's
Code assessment SHALL describe the same flow.

#### Scenario: Reading the notice

- **WHEN** anyone opens the privacy notice, in any locale
- **THEN** sections 3, 6 and 8 say the notification is deleted with the feedback

Source: `app/privacy/page.tsx`, `app/privacy/page.test.tsx` "says the Discord bug notification is deleted with the feedback (ops #405)".
