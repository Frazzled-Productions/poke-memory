## Root cause

**Current behaviour.** A bug-category row fires the trigger in migration 042. The route reads the
message by id and posts up to 500 characters to the Discord webhook. Later the row goes, through the
12-month purge or the account cascade, and the Discord post does not.

**Expected behaviour.** Personal text typed into feedback lives only where our deletion reaches it.

**Unchanged behaviour:**

- WHEN a bug report is filed THEN the maintainer SHALL CONTINUE TO get one embed with page, app
  version, signed-in state, timestamp and a link to the row.
- WHEN the trigger payload holds `message` or `user_id` THEN the route SHALL CONTINUE TO refuse it
  with 400.
- WHEN the bearer secret is wrong THEN the route SHALL CONTINUE TO return 401 and post nothing.
- WHEN the webhook fails THEN the route SHALL CONTINUE TO return 502.

**Tried before.** Nothing has tried to fix this. #1848 (PR #1878, 11 June 2026) kept the text out of
`pg_net` by fetching it in the route, which was the question it asked. Retention of the Discord copy
was not on its list of acceptance criteria.

**Hypotheses:**

| Hypothesis | Result | Evidence |
|---|---|---|
| Something deletes the Discord post | Ruled out | **Seen:** no Discord call outside `app/api/discord/`; no `wait=true`, `DELETE` or `PATCH` under `app/api`, so no message id is ever kept |
| The purge or cascade reaches beyond the row | Ruled out | **Cited:** `db/migrations/034_feedback.sql:56` is a plain `DELETE FROM feedback`; line 17 is a foreign key |
| The text only goes in some configurations | Ruled out in practice | **Cited:** the only condition is a Supabase key being set, and the digest, feedback and push routes need that key |
| The channel expires old posts by itself | Unknown | Agents have no Discord access; not looked at |

**Mechanism (Seen).** The real route with a mocked webhook and a sentinel row, on `qa` at d2456f44:
`expected '{"embeds":[{"title":"New bug report",…' not to contain 'sentinel text a child typed'`.

**First wrong step.** `app/api/discord/notify/route.ts:138` on `qa`, the call to
`fetchMessagePreview`: it copies erasable data to a store with no erasure path.

**Other places with the same fault.** The weekly digest sends counts only, pinned by its "CRITICAL"
tests. The other embed fields are not typed text in the app's form (ops #407 covers the rest).

**Failing test that lands before the fix.** "CRITICAL: Discord webhook payload contains no message
text" and "CRITICAL: the route never opens a Supabase client".

**Always-on signal.** The first of those pins the exact list of embed field names, so any new field
fails a test and gets looked at.

## Decisions

**Remove rather than delete later.** See open call 1 in proposal.md. The smallest change that makes
the notice true is to stop sending the text.

**Keep the forbidden-fields guard.** It protects the trigger payload, which is a separate thing.

**Keep the sentinel mock of `@supabase/supabase-js`.** The route no longer imports it, but the mock
holds a real-looking row, so a future read would turn the two tests red rather than fail on a
missing client.

**No change to migration 042.** Its comment, "never message, never user_id", becomes true of the whole
path again.

## Risks

- **Triage now depends on the deep link.** It is the only way from Discord to the text, and it could
  not be opened without a dashboard login. The URL has no table id, so it may not land on the row.
  Fraser checks it in ops #406; the route code for it is unchanged.
- **Text already in the channel stays until ops #406 is done,** so that step belongs straight after
  promotion to `main`.
