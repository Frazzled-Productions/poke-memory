## 1. Before the build

- [x] 1.1 Fraser settles open call 1 (preview or not). Verify: ruling comment "Ruling 2026-11-02 (Fraser)" on PR #2213, recorded in Clarifications.

## 2. Route and database

- [x] 2.1 Failing tests first in `app/api/discord/notify/route.test.tsx`: "posts to the Discord webhook URL with wait=true", "stores the Discord message id (ops #405)" and "deletes the post with the feedback (ops #405)". Verify: red against the `qa` route (exit 1, 12 failed, 30 passed of 42, re-run 3 November 2026 after the review found the first counts were taken on an earlier test set), then green (exit 0, 42 passed).
- [x] 2.2 Route posts with `wait=true`, stores the message id, and handles the deletion event. Verify: the tests in 2.1 and `npm run typecheck`.
- [x] 2.4 Review fixes (3 November 2026): only 404 code 10008 counts as deleted, a 429 is retried twice after `retry_after`, a deletion event without an id answers 400, and a row deleted before its id was stored has its post deleted by the route. Verify: 5 new tests red against the head route (exit 1, 5 failed, 44 passed), then green (exit 0, 49 passed); `npm run typecheck`.
- [x] 2.3 Migration 051: `feedback_discord_posts`, deny-all policy, AFTER DELETE trigger. Verify: the integration-tests job applies every migration on CI's postgres; `scripts/persistence-tables.test.mjs` with the new inventory rows.

## 3. Notice and records

- [x] 3.1 Notice sections 3, 6 and 8, and "Last updated" to 3 November 2026. Verify: `app/privacy/page.test.tsx` "says the Discord bug notification is deleted with the feedback (ops #405)" and the date test, red first (exit 1, 2 failed), then green (exit 0, 20 passed).
- [x] 3.2 `docs/dpia.md` and `docs/childrens-code-assessment.md`. Verify: both mention deletion with the feedback row, by search for "ops #405".
- [x] 3.3 `changed` changelog fragment. Verify: `npm run lint:changelog`.

## 4. Finish

- [x] 4.1 Run `/opsx:verify discord-bug-notification-deleted-with-feedback`. Verify: result in the PR body.
- [x] 4.2 ~~Apply migration 051 to QA and production, check a deletion on QA, set "Last updated" to the merge date if later~~ Moved to #2368 (3 November 2026).
- [x] 4.3 ~~Delete posts sent before this change from the Discord channel~~ Moved to ops #406 (2 November 2026).
- [x] 4.4 ~~Retry a deletion that failed when the row went~~ Moved to #2369 (3 November 2026).
