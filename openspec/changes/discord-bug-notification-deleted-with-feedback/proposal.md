## Why

When someone files a bug report, the maintainer gets a Discord notification holding up to 500
characters of what they typed (#1848). Feedback in our database is deleted after 12 months or with
the account, but the Discord post was not, so the text outlived our own deletion. Children use this
service and may type personal details. Refs ops #405 (held privately in Frazzled-Productions/ops).

Fraser ruled on 2 November 2026: keep the Discord preview (the #1848 ruling stands) and delete the
text later instead. This change replaces the earlier draft that removed the preview.

## What Changes

- **The notification keeps its preview and is deleted with its feedback.** The notify route posts with
  `?wait=true` and stores the Discord message id in a new service-role table,
  `feedback_discord_posts` (migration 051). An AFTER DELETE trigger on `feedback` sends a deletion
  event to the same route, which deletes the Discord message and then the stored id. This covers the
  12-month purge and the account cascade alike.
- **The privacy notice, DPIA and Children's Code assessment say so.** Notice sections 3, 6 and 8 say
  the notification is deleted when the feedback is; "Last updated" moves to 3 November 2026.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change, none
  of them send or read feedback.
- **Settings:** no change. `FeedbackModal` posts the same fields to `/api/feedback`.
- **Guest mode (localStorage):** no change on the device. Guest bug reports are deleted by the purge,
  and their Discord posts with them.
- **Cloud sync and Supabase migrations (both projects):** new migration 051 (table, deny-all policy,
  trigger function, trigger). Not applied here: Fraser applies it to QA, then production with the
  promotion (#2368). The "Migration check" job stays red until QA has it. 049 and 050 are held by
  PRs #2205 and #2221. The table inventory in `docs/persistence.md` and AGENTS.md gains the table.
- **Superuser mode and QA-seed scenarios:** no change, the route runs on the server from database
  triggers.
- **Locales:** no catalogue change. The notice is English only, with an existing note for other
  locales; `ChildFriendlySummary` and `messages/` do not mention Discord.
- **Push notifications and the service worker (offline):** no change.
- **Sign-in:** no change. Account deletion already cascades to `feedback`, which now fires the trigger.
- **Privacy notice and sub-processors:** sections 3, 6 and 8 change as above. Discord stays a
  sub-processor holding the same data, for less time.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `changed` fragment.
- **CI and GitHub Actions:** no workflow change. No new Vault secret or Vercel variable: the trigger
  reuses `discord_notify_url` and `cron_shared_secret`, and the route its existing Discord webhook.
- **Weekly digest:** no change, it sends counts only.
- **PR #2207 (`supabase-keys`):** no longer overlaps, as this change leaves the route's key use alone.

## Removes

- The baseline note that text posted to Discord stays there, and the note that a removal was in draft.
- The earlier draft of this PR (change `discord-bug-notification-no-text`, its `feedback-notifications`
  capability and its `supabase-keys` edit), which the ruling replaced.

## Out of scope

- Posts sent before this change: no message id was stored for them, so Fraser deletes them by hand
  (ops #406).
- Retrying a deletion that failed when the row went: #2369.
- Checking the other embed fields against a list: ops #407.
- The other findings in the same audit (ops #378).

## Owner decisions relied on

- 11 June 2026 (#1848): a capped preview in Discord is acceptable.
- 2 November 2026: keep the preview (#1848 stands) and delete the text later (ruling comment on
  PR #2213).
- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 26 October 2026: poke-memory PRs merge into `qa`; promotion to `main` and releases stay with Fraser.

## Clarifications

1. 2 November 2026, Fraser: remove the preview, or keep it and delete the Discord copy? Keep it and
   delete the text later (#1848 stands).
2. 3 November 2026, open, built as recommended: "later" means when the feedback row is deleted (the
   12-month purge or account deletion), and the whole Discord message goes rather than an edit that
   strips the preview. Recommended because it keeps the notice to one rule and leaves nothing pointing
   at a deleted row. A fixed shorter window (say 30 days) is the alternative.
3. 3 November 2026, open: a deletion that fails because Discord is down is not retried, so that post
   stays. Recommended: accept for now and build the backstop sweep in #2369.
4. 3 November 2026, open: notice wording in sections 3, 6 and 8. Recommended: Fraser reads the three
   passages; "Last updated" becomes the merge date if later (#2368).
5. 3 November 2026, open: the notice's new sentence is only true once migration 051 is on production
   and ops #406 has cleared older posts. Recommended: apply 051 before promotion and do ops #406 straight
   after (#2368).
