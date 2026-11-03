## Root cause

**Current behaviour.** A bug-category row fires the trigger in migration 042. The route reads the
message by id and posts up to 500 characters to the Discord webhook. Later the row goes, through the
12-month purge or the account cascade, and the Discord post does not: no message id is ever kept, so
nothing can delete it.

**Expected behaviour.** Personal text typed into feedback lives only as long as the feedback row.

**First wrong step.** The route posts without `?wait=true` and keeps nothing it could delete by.

## Decisions

**Store the Discord message id, delete on row deletion.** Discord webhooks can delete their own
messages (`DELETE /webhooks/{id}/{token}/messages/{message_id}`) but cannot list them, so the id has
to be kept. `feedback_discord_posts` holds it with no foreign key to `feedback`, because it must outlive
the row until the post is gone, and no user id or text.

**One trigger, one route, no new secrets.** The AFTER DELETE trigger mirrors 042: Vault secrets,
`pg_net`, DO/EXCEPTION wrapping for CI, and never blocking the delete. It posts `{ event, id }` to the
existing notify route, which already has the webhook URL and the service-role key. The trigger only
calls out when a stored id exists, so feature requests and pre-change rows cost nothing.

**Delete the message, not edit it.** Once the row is gone the post links to nothing; removing it whole
keeps the notice to one rule (open call 2).

**Only "Unknown Message" counts as deleted.** Someone may already have removed the post in Discord, so a
404 with code 10008 removes the stored id. A 404 with code 10015 (Unknown Webhook, after the webhook is
deleted or replaced) keeps the id and answers 502, since the post may still be up (review, 3 November 2026).

**Rate limits are retried in the route.** The purge and the account cascade can delete several bug
reports in one statement, one trigger call each, all against one webhook. A 429 is retried twice after
Discord's `retry_after` (capped at 3 seconds); a delete still throttled after that falls to #2369.

**A row deleted before its id is stored.** The delete trigger finds no stored id and does nothing, so
after storing the id the route re-reads the row and deletes the post itself if the row is gone. A
window of milliseconds remains where both checks miss; #2369's sweep covers it.

## Risks

- **A failed deletion is not retried** (Discord down at that moment). The stored id stays for a later
  sweep, #2369.
- **Posts from before this change** have no stored id and need ops #406.
- **Until migration 051 is applied** the insert fails (logged) and nothing is deleted; #2368.
  051 must be on production before or with the promotion that ships this route, or posts sent in
  between have no stored id and are not covered by ops #406 as worded.
