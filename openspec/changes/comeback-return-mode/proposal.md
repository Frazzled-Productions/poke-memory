## Why

A player who stops for a while comes back to a long queue of overdue reviews, and the queue itself
puts them off returning. Fraser is one of them (#2191). Production data on 2026-10-26: 12 signed-in
players have reviews, and 10 have been away 7 or more days. The median overdue count is 76 for 7 to
29 days away, 31 for 30 to 89 days and 119 for 90+ days, with a maximum of 740. Today the queue picks
overdue reviews at random up to 100 per direction (about 200 a day), with no total cap. An FSRS
author's simulation under a cap puts random order at about 65% true retention, against about 80% for
likely-remembered-first. Research: `research/pokememory-comeback-backlog-2026-10-26.md` in
Frazzled-Productions/ops (ops PR #286).

## What Changes

- **Smarter order for everyone.** When the cap binds, overdue reviews are picked, and served,
  highest FSRS retrievability first (a new exported helper in `lib/srs/scheduler.ts`, using
  `ts-fsrs` `get_retrievability`), instead of a random hash pick. The hash stays as the tie-break.
- **Return mode.** It starts at session load after 7 or more UTC days with no review (latest
  `lastReview` in the active locale), unless the new Settings toggle "Ease me back in after a break"
  (on by default) is off.
  - **Ramp:** a total review cap of 20, then 40, then 80 on the first three days studied, split
    across directions by what is due. Then normal caps.
  - **Ends early** when nothing is overdue. A new 7-day gap restarts it.
  - **New cards paused** while it is on (priority species included), with one line saying why.
  - **"Keep going"** on the done-for-today screen lifts the return cap (as "Keep reviewing" lifts
    review caps today).
  - **Bounded postpone** once at the start: overdue cards not admitted on day one, most likely
    remembered and most stable first, move later by at most 15% of their interval. Only `dueDate`
    changes.
  - **Today's goal, not the backlog.** The practice counter, app-icon and title badges, language
    switcher and daily push show what is left of today's goal, never the backlog total.
  - **Welcome-back card:** "Welcome back! Let's warm up with 20 Pokémon." with the favourite partner
    from #2187 when set. No streak, missed-days or forgetting language.
- **Three synced settings keys:** `returnModeEnabled`, `returnModeStartedOn` and
  `returnModeStudyDays`. All are scalars, protected on pulls like the #2187 favourite keys.
- Copy in all four locales, a What's new entry, a QA-seed "lapsed player" scenario, the Children's
  Code Standard 13 note, and a `minor-bump` changelog fragment.

## Also touches

- **Review and quiz screens (home):**
  - The review pick and serving order change, and the return-mode cap and paused new cards apply.
  - The end screen gets a "done for today" variant with "Keep going".
  - The welcome-back card appears on the first return session.
  - Baselines: `review-queue` here; `new-card-order` comes from #2189.
- **Pokédex, Pasture:** no change, because neither reads due counts or the queue.
- **Stats:** no change to its figures. Stats shows no raw backlog total today (baseline), and its
  day-0 forecast bar is already capped. `lib/stats/dashboard-snapshot.ts:172` keeps counting with
  the shared `buildSessionQueues`, so the counts follow the new order.
- **Journey:** no change.
- **Settings:** a new toggle "Ease me back in after a break".
- **What's new:** one entry.
- **Guest mode (localStorage):** the three keys live in the settings blob. Return mode works the
  same for guests from their local cards.
- **Cloud sync and Supabase migrations (both projects):**
  - No migration.
  - Postponed cards are pushed with only `due_date` changed. The regression trigger (migrations 002
    and 015 to 017) never checks `due_date`, so pushes from both the postponing device and a stale
    device are accepted (safety fact below).
  - The settings keys ride `merge_user_settings`.
- **Superuser mode and QA-seed scenarios:**
  - A "lapsed player" scenario (21 days away, about 150 overdue).
  - `pretendAllMastered` does not affect return mode, which reads review dates, not mastery.
  - The sync write-guard applies to the postpone pushes as to any card write.
- **Locales:** about 12 new catalogue keys in all four locales, plus the pseudo-locale.
- **Push notifications and the service worker:** `app/api/push/send-daily/route.ts` reads the
  return-mode keys from the settings row and sends today's remaining goal as its count. The service
  worker is unchanged.
- **Sign-in:** no change. The conflict picker carries the keys with the blob.
- **Privacy notice and sub-processors:** no change, because settings and card schedules are
  already disclosed and no new processor or data category is added. The Children's Code Standard 13
  re-check (a neutral one-off welcome, no streak or loss framing) is recorded in
  `docs/childrens-code-assessment.md`.
- **Accessibility:** the welcome-back card is a labelled region, "Keep going" is a normal button,
  and there is no new motion.
- **README screenshots:** no change. The six surfaces' seeded states are not lapsed.
- **Changelog fragments and the release:** `minor-bump` plus `added` fragments; needs Fraser's
  `version-bump:approved`.
- **CI and GitHub Actions:** no workflow change.

**Safety fact (blast radius).** The postpone changes only `dueDate`. Because of that, nothing in
sync can reject it, and FSRS still sees the true elapsed time:
- The queue reads `state.dueDate` (`lib/review/session.ts:702`).
- `card_reviews_reject_regression_trigger` checks `last_review`, `first_seen`, `reps`, `lapses`,
  `seen_in_pasture`, and `scheduled_days` only when `last_review` is unchanged. It never checks
  `due_date`.
- The existing scope snooze (`lib/review/filters.ts:66-101`) already shifts `dueDate` the same way
  in production.

Checked by reading migrations 002, 015, 016 and 017 and `filters.ts` (rung 3, walked through). Tasks
4.3 and 6.2 lift it to rung 4 with a unit test and an integration test. Moving `scheduled_days`
instead would let a stale device's push trip the trigger and flip sync into error. That is why the
spec forbids it.

## Removes

- The random hash pick of capped reviews (`shuffle(...).slice(...)` at `lib/review/session.ts:719`
  and the merged reshuffle at `:851`). The hash remains only as a tie-break.
- The baseline rules "nothing caps the sum" and "nothing reschedules overdue cards", replaced as
  noted in their titles.

## Out of scope

- Vacation mode (it has to be switched on before a break, so it doesn't help a lapsed player).
- A "caught up by <date>" projection, or showing the backlog total in return mode.
- Any change to normal-day caps or their Settings controls (including the missing cry-cap control,
  baseline oddity 6).
- The baseline oddities: locale-blind wall checks, local versus UTC days in badges, the teaser and
  push, the language-switcher cache counting out-of-scope cards, and the stale `computeStats` doc.
  Filed as #2193.
- The #2187 favourite finder (follows this change).

## Dependencies

Builds on PR #2189 (#2187 change 1): the partner sprite, `keepDeviceFavouriteKeys` (generalised here
to cover the return-mode keys), and `priorityNewSpeciesIds`. The build starts after #2189 merges into
`qa`; the proposal is written now.

## Owner decisions relied on

All from Fraser on 2026-10-26 (grilling recorded on #2191):

- Scope: retrievability order, a gentle return mode and a bounded postpone.
- Order: likely-remembered first.
- Return mode after 7 days away; a first session of 20 in total; doubling each day studied; new cards
  paused until it ends; postpone automatic and bounded.
- Show today's goal only; fresh-start, partner-led copy.
- A Settings opt-out; restart after a new lapse.
- Comeback before the finder.
- A production aggregate query was allowed (run 2026-10-26, results above).

## Clarifications

- 2026-10-26 Q: How much to build? A: Order, plus return mode, plus postpone.
- 2026-10-26 Q: Which overdue cards first? A: Likely-remembered first (retrievability descending).
- 2026-10-26 Q: Run one read-only production aggregate query? A: Yes.
- 2026-10-26 Q: Label #2191 needs-decision and link the research? A: Yes.
- 2026-10-26 Q: Gap before return mode? A: 7 days.
- 2026-10-26 Q: First session size? A: 20 reviews.
- 2026-10-26 Q: Ramp? A: Double each day studied (20, 40, 80, then normal).
- 2026-10-26 Q: New cards during return mode? A: Paused until caught up.
- 2026-10-26 Q: Postpone mechanism? A: Automatic and bounded (at most about 15% of interval).
- 2026-10-26 Q: Backlog display? A: Today's goal only.
- 2026-10-26 Q: Welcome-back tone? A: Fresh start, partner-led.
- 2026-10-26 Q: 20 total or per direction? A: 20 in total.
- 2026-10-26 Q: Opt-out? A: Yes, a Settings toggle, on by default.
- 2026-10-26 Q: Lapse again mid-ramp? A: Restart the ramp.
- 2026-10-26 Q: Comeback or finder next? A: Comeback first.
- 2026-10-26 Q: Shared understanding? A: Yes; write the proposal now.
- 2026-10-26 Q: Backlog total on Stats in return mode? A: Shown nowhere (Stats has no raw total today).
- 2026-10-26 Q: Approve the proposal? A: Yes; push and open a draft PR, build after #2189 merges.
