## Why

When someone files a bug report, the maintainer gets a Discord notification. Since #1848 it has
included up to 500 characters of what they typed. Feedback in our database is deleted after 12 months
or with the account, but neither reaches Discord, so the text should not go there. Children use this
service and may type personal details. Refs ops #405 (held privately in Frazzled-Productions/ops).

## What Changes

- **The notification carries no message text.** `app/api/discord/notify/route.ts` no longer reads the
  `feedback` table and the embed loses its "Message preview" field. Page, app version, signed-in
  state, timestamp and the Supabase link stay.
- **The privacy notice, DPIA and Children's Code assessment describe the new flow.** Notice sections
  3 and 6 say no message text goes to Discord, and section 3 says the notification stays in the
  channel after the feedback is deleted.
- **The route stops using a Supabase key.** Its only read was the preview, so the `supabase-keys`
  requirement drops it.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change, none
  of them send or read feedback.
- **Settings:** no change. `FeedbackModal` posts the same fields to `/api/feedback`.
- **Guest mode (localStorage):** no change on the device. Guest reports get the same embed, without
  text.
- **Cloud sync and Supabase migrations (both projects):** no migration. The trigger in migration 042
  already sends no message and no `user_id`, and stays as it is.
- **Superuser mode and QA-seed scenarios:** no change, the route runs on the server from a database
  trigger.
- **Locales:** no catalogue change. The notice is English only, with an existing note for other
  locales; `ChildFriendlySummary` and `messages/` do not mention Discord (searched).
- **Push notifications and the service worker (offline):** no change.
- **Sign-in:** no change.
- **Privacy notice and sub-processors:** changes as above. Discord stays a sub-processor, with less
  data. "Last updated" moves on.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `changed` fragment. The change reaches users when `qa`
  is promoted to `main`; clearing text already in the channel follows that (ops #406).
- **CI and GitHub Actions:** no workflow change. `.env.local.example` still holds: other routes use
  the secret key. The Vercel variables stay, because the digest, feedback and push routes read them.
- **Weekly digest:** no change, it already sends counts only.

## Removes

- `fetchMessagePreview`, `MESSAGE_PREVIEW_MAX`, the `createClient` and `supabaseSecretKey` imports
  and the "Message preview" field in `app/api/discord/notify/route.ts`.
- The six `#1848` preview tests in `route.test.tsx`, replaced by three that pin the opposite.
- The route's mention in the `supabase-keys` requirement.

## Out of scope

- Deleting text already in Discord: Fraser's step, ops #406.
- Checking the other embed fields against a list: ops #407.
- Deleting Discord posts when a feedback row is deleted (see open call 1).
- The other findings in the same audit (ops #378).

## Owner decisions relied on

- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 26 October 2026: poke-memory PRs merge into `qa`; promotion to `main` and releases stay with Fraser.
- This reverses the #1848 ruling (privacy review, 11 June 2026) that a capped preview was acceptable.
  That was a privacy-expert ruling with no recorded owner answer, so it is raised as open call 1
  rather than treated as settled.

## Clarifications

No grilling took place: this was built unattended on 2 November 2026 and every call below is open.
The build assumes each recommendation.

1. **2 November 2026, open: remove the preview, or keep it and delete the Discord copy?** Recommended:
   remove it. Triage takes one more click, into Supabase. Keeping it would need posts sent with
   `?wait=true`, a stored Discord message id per row, and deletion on both the purge and the account
   cascade, for a copy we do not need. Changing the notice to say the text is kept indefinitely is the
   third option and the weakest for a service in scope of the Children's Code.
2. **2 November 2026, open: is it right for the remaining metadata to stay in Discord?** Recommended:
   yes, disclosed in one sentence in section 3. Once the row is gone the post holds a page, a version,
   a time, a signed-in flag and a link to nothing. A sweep of old posts would need the same machinery
   as option two in call 1.
3. **2 November 2026, open: notice wording.** Recommended: Fraser reads the two changed passages, as
   the owner of the notice. The "Last updated" date is 2 November 2026 here and should become the date
   of merge.
4. **2 November 2026, open: tell existing users?** Recommended: no, beyond the changelog and the date.
   The change sends less data and adds no purpose.
5. **2 November 2026, open: order against PR #2207.** It edits the same `supabase-keys` requirement.
   Recommended: whichever lands second rebases and keeps both edits, giving "digest, feedback, push
   send-daily and push send-streak-nudge routes and the username sign-up action".
