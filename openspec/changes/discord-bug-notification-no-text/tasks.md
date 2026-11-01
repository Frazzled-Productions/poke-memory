## 1. Before the build

- [ ] 1.1 Fraser settles the five open calls in proposal.md. Verify: Clarifications holds his dated answers.

## 2. Route

- [x] 2.1 Failing tests first in `app/api/discord/notify/route.test.tsx`: "CRITICAL: Discord webhook payload contains no message text", "CRITICAL: the route never opens a Supabase client", "posts the embed with no Supabase key set". Verify: red run in the PR body, then green.
- [x] 2.2 Remove `fetchMessagePreview`, the preview field and the Supabase imports from the route. Verify: the tests in 2.1 and `npm run typecheck`.

## 3. Notice and records

- [x] 3.1 Notice sections 3, 6 and 8, and "Last updated". Verify: `app/privacy/page.test.tsx` "says bug notifications carry no message text and what stays in Discord", red first.
- [x] 3.2 `docs/dpia.md` and `docs/childrens-code-assessment.md`. Verify: no "capped at 500" or "message preview" left outside this change's history, by search.
- [x] 3.3 `changed` changelog fragment. Verify: `npm run lint:changelog`.

## 4. Finish

- [x] 4.1 Run `blast-radius` and check each spec requirement against the diff. Verify: results in the PR body.
- [ ] 4.4 Run `/opsx:verify discord-bug-notification-no-text` and `final-review` with fresh reviewers. The spike's unattended run could not start them. One separate agent then ran the four final-review lenses by hand on 2 November 2026, which is not four independent reviewers, and `/opsx:verify` is still to run. Verify: findings fixed or listed in the PR.
- [ ] 4.2 Set "Last updated" to the merge date. Verify: `app/privacy/page.test.tsx` date test.
- [x] 4.3 ~~Delete old text from the Discord channel and open a deep link~~ Moved to ops #406 (2 November 2026).
