## Purpose

How Poké Memory chooses and caps the review cards (graduated cards that are due) it serves each day, what a review does to a card's schedule, and which due figures the player sees. Requirements marked "(baseline, current behaviour)" are current behaviour on `qa` at d6848e4c from code and tests and stay true; change comeback-return-mode (#2191) replaces the random pick with retrievability order and links to return mode.

## ADDED Requirements

### Requirement: A review candidate is a graduated card due on or before today (baseline, current behaviour)

`buildSessionQueues` SHALL treat a card as a review candidate when it is in the active locale, not in
a learning step, in the eligible set (enabled type and practice scope), has `lastReview` set, has
`dueDate <= today` and was not reviewed today. Dates are UTC `YYYY-MM-DD` strings compared as text;
"overdue" has no other measure, so a card 30 days late and a card due today are equal candidates.

#### Scenario: Overdue and due-today cards are equal candidates

- **WHEN** one name card is due today and another was due 30 days ago, neither reviewed today
- **THEN** both are in the name review candidates, with nothing recording how late either is

#### Scenario: A card reviewed today is not a candidate

- **WHEN** a graduated card has `lastReview` equal to today (even if its new `dueDate` is today, as after a lapse)
- **THEN** it is not a review candidate; a lapsed card returns through the in-memory learning queue instead

<!-- source: lib/review/session.ts:689-709 -->

### Requirement: Review cap defaults and settings (baseline, current behaviour)

The defaults SHALL be 100 name, 50 evolution, 100 reverse and 100 cry reviews a day
(`DEFAULT_SETTINGS`, mirrored by `DEFAULT_LIMITS`). Settings SHALL offer a 1 to 500 control for the
name, evolution and reverse caps only; the cry cap has no control. Practice SHALL read the caps from
settings when the session loads (`limitsFromSettings`), ignoring the limits saved with the session,
so a change applies on the next load.

#### Scenario: Default player with every direction on

- **WHEN** a player who never changed a cap has name, evolution, reverse and cry cards on
- **THEN** up to 350 reviews a day can be queued before any soft wall (100 + 50 + 100 + 100)

<!-- source: lib/settings/persistence.ts:551-565, lib/review/session.ts:117-122, app/settings/page.tsx:330-377, components/review/ReviewSession.tsx:181-200 and components/review/ReviewSession.tsx:1263-1266 -->

### Requirement: Learning cards first, then reviews, then new cards (baseline, current behaviour)

The session SHALL serve a due learning-queue card first, otherwise the head of the review queue,
otherwise the head of the new queue, and only then a learning card within the learn-ahead window. New
cards therefore appear only after every capped review is done. Nothing pauses new cards after a gap:
new-card budgets depend only on the per-direction new caps and today's introductions.

#### Scenario: New cards wait for reviews

- **WHEN** 20 reviews and 10 new cards are queued and no learning card is due
- **THEN** all 20 reviews are served before the first new card

<!-- source: lib/review/session.ts:879-886, components/review/ReviewSession.tsx:1925-1950, lib/review/session.ts:749-754 -->

### Requirement: Soft wall and "Keep reviewing" (baseline, current behaviour)

With no card left to serve, the session SHALL show "Daily review limit reached" (`REVIEW_SOFT_WALL`)
when some bucket's `reviewsDoneToday` has reached its cap and that bucket still has a due review among
enabled card types. "Keep reviewing" SHALL set `extendedReview`, which makes every bucket's review cap
infinite but leaves new-card caps alone; the flag is not saved and resets on reload.

#### Scenario: Keep reviewing lifts every review cap

- **WHEN** the name cap is reached with more name reviews due and the player taps "Keep reviewing"
- **THEN** the queue is rebuilt with `maxReviewsPerDay` infinite for all four buckets, so every due review is served, and new-card caps are unchanged

#### Scenario: The wall comes back after a reload

- **WHEN** the player reloads the page while reviews beyond the cap remain due
- **THEN** `extendedReview` is false again and the soft wall shows once the capped queue is empty

<!-- source: components/review/ReviewSession.tsx:2085-2122, components/review/ReviewSession.tsx:1890-1900, components/review/ReviewSession.tsx:1726-1733, components/review/ReviewSession.tsx:860-862, components/review/ReviewSession.tsx:2196-2201; test components/review/ReviewSession.test.tsx:2287 -->

### Requirement: End-of-session states and their order (baseline, current behaviour)

With no card left and no future learning card, the end state SHALL be the soft wall when it applies
and `extendedReview` is off, otherwise "New cards locked for today" (`NEW_CARDS_LOCKED`) when a
bucket's `newIntroducedToday` has reached its new cap and it still has unseen cards, otherwise "All
caught up" (`SESSION_COMPLETE`). Every variant shows the due-tomorrow teaser, the Done today pill and
the share button when they apply.

#### Scenario: Reviews done, new cap reached

- **WHEN** no reviews are left, no review cap was hit, and the name new-card cap is used with unseen name cards left
- **THEN** the screen reads "New cards locked for today"

#### Scenario: Nothing left at all

- **WHEN** no bucket is at a cap with work remaining
- **THEN** the screen reads "All caught up"

<!-- source: components/review/ReviewSession.tsx:2124-2131, components/review/ReviewSession.tsx:520-680; tests components/review/ReviewSession.test.tsx:2233, components/review/ReviewSession.test.tsx:2776 -->

### Requirement: What a review does to the schedule (baseline, current behaviour)

Grading a graduated card Hard, Good or Easy SHALL run the `ts-fsrs` scheduler (the player's retention
target and optimised weights when set) and store its stability, difficulty, reps, state and `dueDate`
(the FSRS due as a UTC date), with `lastReview` set to today's UTC date. Again SHALL apply the FSRS
lapse, set `dueDate` and `lastReview` to today and enter relearning step 0. `lastReview` holds a date
only, so FSRS sees the last review as UTC midnight.

#### Scenario: Good on an overdue card

- **WHEN** a review card due 20 days ago is graded Good
- **THEN** FSRS computes the new stability from the elapsed time since `lastReview`, `dueDate` moves to the FSRS due date and `lastReview` becomes today (UTC)

#### Scenario: Again on a review card

- **WHEN** a review card is graded Again
- **THEN** its lapse count rises, `dueDate` and `lastReview` become today, `learningStep` becomes 0 and it leaves the review queue for the learning queue

<!-- source: lib/srs/scheduler.ts:395-428, lib/srs/scheduler.ts:185-205, lib/srs/scheduler.ts:124-134, components/review/ReviewSession.tsx:2585-2586 -->

### Requirement: Counts shown during and after a session (baseline, current behaviour)

The queue counter row SHALL show the new, learning and review queue lengths after caps (so never the
raw backlog while caps bind). The Done today pill SHALL show per-direction new and reviewed counts.
The end screen SHALL show "N reviews due tomorrow" from `countDueTomorrow`, an uncapped count of
graduated cards whose `dueDate` equals tomorrow, with a capped new-card estimate beside it.

#### Scenario: Large backlog, capped counter

- **WHEN** 400 name reviews are due and the name cap is 100 with none done
- **THEN** the review counter shows 100, not 400

<!-- source: components/review/ReviewSession.tsx:2058-2062, components/review/QueueCounterRow.tsx:11-26, components/review/ReviewSession.tsx:372-470, lib/review/session.ts:906-931, components/review/ReviewSession.tsx:2177-2190 -->

### Requirement: Due badges (baseline, current behaviour)

The app-icon badge and the `(N)` title prefix SHALL show today's capped queue total (new plus learning
plus review) through `computeQueueCount`, the same helper as the Stats forecast (#1099, #1137). The
language switcher's "N due today" SHALL show the uncapped count of due reviews per locale from the
due-count cache, written on load and after each grade, without card-type or scope filtering.

#### Scenario: Badge versus language switcher

- **WHEN** 400 name reviews are due, the name cap is 100, and no other card is queued
- **THEN** the app-icon badge shows 100 while the language switcher shows "400 due today"

<!-- source: components/pwa/usePwaBadge.ts:59-87, components/pwa/useDocumentTitleBadge.ts:60-90, lib/stats/dashboard-snapshot.ts:165-218, components/review/ReviewSession.tsx:325-352, components/review/ReviewSession.tsx:1481, components/review/ReviewSession.tsx:2833, lib/profile/dueCountCache.ts:46-81, components/i18n/LanguageSwitcher.tsx:160-250 -->

### Requirement: Daily push due count (baseline, current behaviour)

The daily push SHALL count, per learning locale, every non-hidden `card_reviews` row with `due_date`
on or before the player's local today that passes the card-type and scope gate, with no per-direction
review cap, and SHALL state that total (with a per-language breakdown when several have cards due)
plus a capped new-card estimate. It sends nothing when both are zero.

#### Scenario: Backlog in the notification

- **WHEN** a signed-in player with push on has 400 eligible rows due and a name review cap of 100
- **THEN** the notification says 400 cards are due

<!-- source: app/api/push/send-daily/route.ts:674-800, app/api/push/send-daily/route.ts:140-200, db/migrations/046_get_push_targets.sql:87-115 -->

### Requirement: Stats page due figures (baseline, current behaviour)

The Stats page SHALL show due work only as the 14-day due forecast: day 0 is the capped queue total
(new plus learning plus review, from the same helper as the badges) and days 1 to 13 count eligible
reviewed cards whose `dueDate` is exactly that day. No Stats figure shows the raw overdue backlog.

#### Scenario: Day 0 is capped

- **WHEN** 400 name reviews are due, the cap is 100 and no new or learning cards are queued
- **THEN** the forecast's today bar shows 100

<!-- source: lib/stats/dashboard-snapshot.ts:285-357, app/stats/page.tsx:385-399, app/stats/page.tsx:582 -->

### Requirement: Study days, streak reset and protection tokens (baseline, current behaviour)

A local day SHALL join the streak dates once at least 5 cards are graded that day or no review is
due. The streak SHALL count back from today, or from yesterday if today is not yet in. A protection
token (one per 30 consecutive study days, at most 3 held) SHALL bridge a gap of up to 3 missed days,
all or nothing. No stored "last study day" or gap check exists; a 7-day gap always resets the streak.

#### Scenario: Away for a week

- **WHEN** a player with 3 tokens and a 60-day streak opens the app after 7 days without studying
- **THEN** the 6 missed days exceed the 3-day bridge, no token is spent and the streak is 0

#### Scenario: Two missed days bridged

- **WHEN** a player with 2 tokens returns after missing exactly 2 days
- **THEN** both tokens are spent and the streak continues

<!-- source: lib/streak/persistence.ts:9-45, components/review/ReviewSession.tsx:2919-2931, lib/streak/compute.ts:10-32, lib/streak/tokens.ts:31-34, lib/streak/tokens.ts:240-300, lib/streak/runProtection.ts:40-60 -->


### Requirement: Reviews are capped per direction; return mode adds a total cap (MODIFIED from the baseline "no total cap" rule)

For each limit bucket (name, evolution with reverse-evolution, reverse, cry) the review queue SHALL
admit at most `max(0, maxReviewsPerDay - reviewsDoneToday)` candidates, counted as today. Outside
return mode nothing caps their sum. In return mode the total cap in the `return-mode` capability
applies as well.

#### Scenario: One direction at its cap does not stop another

- **WHEN** return mode is off, the name bucket has done 100 reviews (cap 100) and 40 reverse reviews are due
- **THEN** the review queue holds no name cards and all 40 reverse cards

#### Scenario: Exact cap boundary

- **WHEN** a bucket's cap is N and N+1 cards are due with none done today
- **THEN** exactly N are queued and the (N+1)th is left out

### Requirement: Overdue reviews are picked likely-remembered first (REPLACES the baseline random pick)

When a bucket has more review candidates than slots, the admitted cards SHALL be those with the
highest FSRS retrievability at the start of today (UTC), computed with the app's scheduler
parameters through one exported helper in `lib/srs/scheduler.ts`. Ties SHALL be broken by the
existing per-day stable hash. The merged review queue SHALL be served in the same order.

#### Scenario: Cap binds

- **WHEN** 300 name reviews are due, the cap is 100, and their retrievability ranges from 0.2 to 0.9
- **THEN** the 100 with the highest retrievability are queued, highest first

#### Scenario: Stable through the day

- **WHEN** the queue is rebuilt after each grade on the same UTC day
- **THEN** the remaining review cards keep their relative order

#### Scenario: Under the cap

- **WHEN** fewer cards are due than the cap allows
- **THEN** every due card is queued, highest retrievability first

### Requirement: Only return mode reschedules overdue cards (MODIFIED from the baseline "nothing reschedules" rule)

Outside return mode, loading a session SHALL NOT move overdue review cards; the only other date shift
SHALL remain the practice-scope snooze (at most 365 days). In return mode, the bounded postpone in the
`return-mode` capability applies once, when return mode starts.

#### Scenario: Normal day

- **WHEN** return mode is off and a player has 160 overdue cards
- **THEN** all 160 stay candidates at their due dates, ordered by retrievability, within the caps

#### Scenario: Scope snooze

- **WHEN** a card was out of the practice scope for 10 days and comes back into scope
- **THEN** its `dueDate` moves 10 days later and `hiddenSince` is cleared
