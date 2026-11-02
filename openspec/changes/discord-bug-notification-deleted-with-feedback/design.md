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

**404 counts as deleted.** Someone may already have removed the post in Discord; the stored id goes.

## Risks

- **A failed deletion is not retried** (Discord down at that moment). The stored id stays for a later
  sweep, #2369.
- **Posts from before this change** have no stored id and need ops #406.
- **Until migration 051 is applied** the insert fails (logged) and nothing is deleted; #2368.
