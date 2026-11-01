# srs-scheduling Specification

## Purpose
How Poké Memory decides when a card comes back and how an answer becomes a grade: the FSRS scheduler
with its learning-step layer, the per-user weight optimiser and its route, typed-entry grading,
multiple-choice and reverse-card distractors, and card identity keys. This is the baseline: current
behaviour on `qa` at d2456f44, written from code and tests, not what it should be. A requirement that
records behaviour which looks wrong says so and names the issue. Line references are to that commit.
Queue order, daily limits, the filter snooze that shifts `dueDate` and mastery rules live in `lib/review`
and `lib/stats` and are out of scope.

## Requirements

### Requirement: Four grades, checked at runtime (baseline)

`nextReview` SHALL accept the grades 1 (Again), 2 (Hard), 4 (Good) and 5 (Easy), mapped to the FSRS
ratings Again, Hard, Good and Easy. Any other value SHALL throw a `RangeError` naming the value,
before any state changes. The review screen SHALL catch that error, show a non-fatal banner and let
the session continue.

#### Scenario: Grade 3 on a graduated card

- **WHEN** `nextReview` is called with grade 3
- **THEN** it throws a `RangeError` whose message lists the valid grades

#### Scenario: A corrupt grade reaches the review screen

- **WHEN** `handleGrade` catches the error
- **THEN** the card is unchanged, the banner shows and grading is unlocked

Source: `lib/srs/scheduler.ts:78`, `lib/srs/scheduler.ts:155`, `lib/srs/scheduler.ts:269`, `lib/srs/scheduler.ts:284`, `components/review/ReviewSession.tsx:2609`, `lib/srs/scheduler.test.ts:584`.

### Requirement: A new card's starting state (baseline)

`initialReviewState` SHALL return a card with zeroed FSRS numbers, `fsrsState` "new", `dueDate` of the
given day, null `lastReview`, `firstSeen`, `learningStep`, `stepStartedAt` and `hiddenSince`, and
`seenInPasture` false.

#### Scenario: Building a card

- **WHEN** `initialReviewState(now)` is called
- **THEN** stability and difficulty are 0 and `dueDate` is the UTC date of `now`

Source: `lib/srs/scheduler.ts:430`, `lib/srs/scheduler.test.ts:80`.

### Requirement: Again, Hard or Good on a brand-new card starts the steps (baseline)

A card with `learningStep` null and `lastReview` null graded 1, 2 or 4 SHALL enter step 0, stamp
`stepStartedAt`, set `firstSeen` if it is null, keep `lastReview` null and not call FSRS. Good does not
skip a step, so a new card on the two-step ladder takes three Goods to graduate.

#### Scenario: Good on a brand-new card

- **WHEN** a brand-new card is graded Good
- **THEN** `learningStep` is 0, `firstSeen` is today, `lastReview` is null and stability stays 0

#### Scenario: Three Goods from new

- **WHEN** a brand-new card is graded Good three times in a row
- **THEN** it passes through step 0 and step 1, and the third Good graduates it

Source: `lib/srs/scheduler.ts:368`, `lib/srs/scheduler.ts:393`, `lib/srs/scheduler.test.ts:98`, `lib/srs/scheduler.test.ts:117`, `lib/srs/intervalPreview.test.ts:39`.

### Requirement: Easy on a brand-new card graduates at once (baseline)

Easy on a brand-new card SHALL run FSRS from an empty card, then force `fsrsState` to "review",
`scheduledDays` to 4 and `dueDate` to four days on, overriding the interval FSRS computed. It SHALL set
`lastReview` to today and `firstSeen` if it is null. The "I already know these" quiz uses this same path,
only on cards with null `lastReview` and null `firstSeen`, and writes a grade 5 grade-log entry for each,
so the optimiser sees those grades.

#### Scenario: Easy first time

- **WHEN** a brand-new card is graded Easy
- **THEN** the card is in review, due in 4 days, with FSRS stability and difficulty set

#### Scenario: Quiz on a card already seen

- **WHEN** a selected card has `firstSeen` set
- **THEN** the quiz leaves it unchanged

Source: `lib/srs/scheduler.ts:371`, `lib/srs/constants.ts:53`, `lib/onboarding/applyKnownGrades.ts:38`, `lib/onboarding/applyKnownGrades.ts:104`, `lib/onboarding/applyKnownGrades.ts:105`, `components/onboarding/KnownPokemonQuiz.tsx:338`, `lib/srs/scheduler.test.ts:128`.

### Requirement: Again and Hard inside a step leave FSRS alone (baseline)

For a card in a step, Again SHALL return to step 0 and stamp `stepStartedAt`. Hard SHALL return the
state unchanged, keeping `stepStartedAt`, so the step timer is not restarted. Neither SHALL call FSRS.

#### Scenario: Again on step 1

- **WHEN** a card on step 1 is graded Again
- **THEN** `learningStep` is 0, `stepStartedAt` is now, and stability and difficulty are unchanged

#### Scenario: Hard on step 1

- **WHEN** a card on step 1 is graded Hard
- **THEN** the returned state equals the input state

Source: `lib/srs/scheduler.ts:303`, `lib/srs/scheduler.ts:312`, `lib/srs/scheduler.test.ts:203`, `lib/srs/scheduler.test.ts:221`, `lib/srs/scheduler.test.ts:279`.

### Requirement: Good inside a step advances, then graduates after one day (baseline)

Good on a non-final step SHALL advance one step, stamp `stepStartedAt` and not call FSRS. Good on the
final step SHALL run FSRS Good, keep its stability, difficulty and counters, then force `fsrsState` to
"review", `scheduledDays` to 1 and `dueDate` to tomorrow, clear the step fields and set `lastReview`
to today. The one-day interval applies to lapsed cards as well, whatever their stability and retention
target.

#### Scenario: Final step of a new card

- **WHEN** a new card on its last step is graded Good
- **THEN** it is in review, `scheduledDays` is 1 and `lastReview` is today

#### Scenario: Final relearning step

- **WHEN** a lapsed card on its last relearning step is graded Good
- **THEN** it is in review and due tomorrow, and `firstSeen` is unchanged

Source: `lib/srs/scheduler.ts:317`, `lib/srs/constants.ts:50`, `lib/srs/scheduler.test.ts:234`, `lib/srs/scheduler.test.ts:252`, `lib/srs/scheduler.test.ts:312`.

### Requirement: Easy inside a step graduates after four days (baseline)

Easy on any step SHALL run FSRS Easy, force `fsrsState` to "review", `scheduledDays` to 4 and `dueDate`
to four days on, clear the step fields and set `lastReview` to today.

#### Scenario: Easy on step 0

- **WHEN** a card on step 0 is graded Easy
- **THEN** it is in review, due in 4 days, with `learningStep` and `stepStartedAt` null

Source: `lib/srs/scheduler.ts:347`, `lib/srs/scheduler.test.ts:264`, `lib/srs/scheduler.test.ts:377`.

### Requirement: Again on a graduated card is a lapse (baseline)

Again on a graduated card SHALL run FSRS Again and keep its results, then set `dueDate` to today,
`learningStep` to 0, stamp `stepStartedAt` and set `lastReview` to today.

#### Scenario: A review card is forgotten

- **WHEN** a graduated card is graded Again
- **THEN** `lapses` rises, `fsrsState` is "relearning", the card is on step 0 and is due today

Source: `lib/srs/scheduler.ts:403`, `lib/srs/scheduler.test.ts:147`.

### Requirement: Hard, Good and Easy on a graduated card are a plain FSRS update (baseline)

These grades SHALL take the interval, due date and FSRS fields from FSRS unchanged, keep the step
fields null and set `lastReview` to today.

#### Scenario: Good on a review card

- **WHEN** a graduated card is graded Good
- **THEN** `reps` rises, the card stays graduated and `dueDate` is the FSRS due date

#### Scenario: Hard does not lapse

- **WHEN** a graduated card is graded Hard
- **THEN** `lapses` is unchanged and the card stays out of the steps

Source: `lib/srs/scheduler.ts:418`, `lib/srs/scheduler.test.ts:166`, `lib/srs/scheduler.test.ts:179`, `lib/srs/scheduler.test.ts:191`.

### Requirement: Step ladders (baseline)

A card in a step with null `lastReview` SHALL use the learning ladder, otherwise the relearning ladder.
Learning by difficulty: 0 or below 1m then 10m; above 0 to 4, 1m; above 4 to 7, 1m then 10m; above 7,
1m, 5m, 15m. Relearning: up to 7, 10m; above 7, 5m then 15m.

#### Scenario: A hard card lapses

- **WHEN** a lapse leaves a card with difficulty above 7
- **THEN** it uses the 5m, 15m ladder and its first Good advances instead of graduating

#### Scenario: A medium card lapses

- **WHEN** a lapse leaves a card with difficulty of 7 or less
- **THEN** it uses the single 10m step and its first Good graduates it

Source: `lib/srs/constants.ts:18`, `lib/srs/constants.ts:33`, `lib/srs/constants.ts:44`, `lib/srs/scheduler.ts:297`, `lib/srs/constants.test.ts:10`, `lib/srs/constants.test.ts:31`, `components/review/ReviewSession.tsx:172`.

### Requirement: New cards always get the middle learning ladder (baseline)

Difficulty SHALL stay 0 until graduation, which also sets `lastReview`, so the difficulty-based learning
bands do not take effect and every new card gets 1m then 10m (#2256). Relearning bands do apply,
because a lapse sets difficulty first.

#### Scenario: A new card in the steps

- **WHEN** a never-graduated card is on a step
- **THEN** its difficulty is 0 and it uses the 1m, 10m ladder

Source: `lib/srs/scheduler.ts:298`, `lib/srs/scheduler.ts:393`, `lib/review/session.ts:391`, `lib/srs/constants.ts:34`.

### Requirement: Scheduler dates are UTC calendar days (baseline)

`dueDate`, `lastReview` and `firstSeen` SHALL be `YYYY-MM-DD` strings in UTC, and intervals SHALL be
added as whole 24-hour days. The scheduler takes no timezone. The review queue compares against the
same UTC day; the difference from the local daily summary is tracked in #2188.

#### Scenario: Evening west of Greenwich

- **WHEN** a card is first graded at 23:30 on 1 March at UTC-8
- **THEN** `firstSeen` is 2 March

#### Scenario: Interval across a clock change

- **WHEN** a one-day interval starts at a daylight-saving boundary
- **THEN** `dueDate` is the next UTC calendar day

Source: `lib/srs/scheduler.ts:132`, `lib/srs/scheduler.ts:136`, `lib/srs/scheduler.ts:290`, `components/review/ReviewSession.tsx:1907`, `lib/srs/scheduler.test.ts:740`, `lib/srs/scheduler.test.ts:804`.

### Requirement: firstSeen is set once and lastReview marks graduation or lapse (baseline)

`firstSeen` SHALL be set on the first grade and never overwritten. `lastReview` SHALL change only when
a card graduates, lapses or gets a graduated update, not on a touch inside a step.

#### Scenario: Graduation keeps firstSeen

- **WHEN** a card with `firstSeen` set graduates on a later day
- **THEN** `firstSeen` keeps its original date

#### Scenario: In-step touch

- **WHEN** a never-graduated card moves between steps
- **THEN** `lastReview` stays null

Source: `lib/srs/scheduler.ts:27`, `lib/srs/scheduler.ts:369`, `lib/srs/scheduler.test.ts:333`.

### Requirement: Retention target and weights are per call (baseline)

`nextReview` SHALL take optional `retentionTarget` and `weights`. With neither (or the default 0.9 and
no or empty weights) it SHALL use the shared default FSRS instance. Other combinations SHALL use an
instance cached by retention at two decimal places plus weights at six. Settings clamps the stored
target to 0.80 to 0.97 and the slider moves in whole percent. The timeline replay passes neither option.

#### Scenario: Higher target schedules sooner

- **WHEN** the same card is graded Good at 0.97 and at 0.85
- **THEN** the 0.97 interval is shorter

#### Scenario: Empty weights

- **WHEN** `weights` is an empty array
- **THEN** the default weights apply and the interval is a finite number

#### Scenario: Timeline replay with a custom target

- **WHEN** a player with a 0.85 target opens the timeline
- **THEN** each replayed grade calls `nextReview` with no options and cards are keyed without locale,
  although the file header says it replays through current per-user weights

Source: `lib/srs/scheduler.ts:80`, `lib/srs/scheduler.ts:95`, `lib/srs/scheduler.ts:253`, `lib/settings/persistence.ts:655`, `lib/timeline/reconstruct.ts:185`, `lib/timeline/reconstruct.ts:195`, `app/settings/page.tsx:941`, `lib/srs/scheduler.test.ts:501`, `lib/srs/scheduler.test.ts:520`, `lib/srs/scheduler.test.ts:554`.

### Requirement: Grading runs on default weights (baseline)

`saveSettings` SHALL write `fsrsWeights`, but `parseStoredSettings` has no field for it, so
`loadSettings` returns it as undefined. Grading, interval previews and the known-Pokémon quiz read
weights from `loadSettings`, so they all use the default weights, even after a successful optimiser
run (#2248). The retention target does reach them.

#### Scenario: After a successful optimiser run

- **WHEN** weights have been saved and the next card is graded
- **THEN** `nextReview` receives `weights: undefined`

#### Scenario: Reading settings back

- **WHEN** `saveSettings` is called with `fsrsWeights` and then `loadSettings` is called
- **THEN** the stored JSON holds the weights and the returned object does not

Source: `lib/settings/persistence.ts:345`, `lib/settings/persistence.ts:777`, `lib/settings/persistence.ts:816`, `lib/settings/persistence.ts:1126`, `components/review/ReviewSession.tsx:2072`, `components/review/ReviewSession.tsx:2603`, `components/onboarding/KnownPokemonQuiz.tsx:279`, `components/onboarding/KnownPokemonQuiz.tsx:296`, `components/settings/FsrsOptimizerSection.tsx:135`.

### Requirement: Impossible FSRS state is rebuilt, not clamped (baseline)

`isFsrsInvalidState` SHALL be true for a non-finite stability or difficulty, stability below 1e-3, or
difficulty outside 1 to 10. On such a card FSRS SHALL start from an empty card, so the grade does not
throw and yields valid values. A healthy card SHALL not be rebuilt. On hydrate, a card flagged while not
brand-new SHALL be reset to a new state that keeps `firstSeen`, `hiddenSince` and `seenInPasture`.

#### Scenario: A review card with stability 0

- **WHEN** it is graded Good
- **THEN** nothing throws and stability is valid

#### Scenario: Brand-new card on hydrate

- **WHEN** a card with `fsrsState` "new" and null `lastReview` is hydrated with stability 0
- **THEN** the heal skips it

Source: `lib/srs/scheduler.ts:172`, `lib/srs/scheduler.ts:185`, `lib/review/session.ts:375`, `lib/srs/scheduler.test.ts:818`, `lib/srs/scheduler.test.ts:872`, `lib/srs/scheduler.test.ts:892`, `lib/srs/scheduler.test.ts:943`.

### Requirement: Grade button previews (baseline)

`previewIntervals` SHALL simulate each grade through `nextReview` with the same options. A result in a
step SHALL read `<Nm`, using the time left on that step rounded up, at least 1. A graduated result
SHALL read `Nd` under 30 days, `Nmo` (days divided by 30, rounded) under 365 days, otherwise `Ny` (days
divided by 365, rounded).

#### Scenario: Brand-new card

- **WHEN** previews are built for a brand-new card
- **THEN** Again, Hard and Good read `<1m` and Easy reads `4d`

#### Scenario: Lapsed card on its last step

- **WHEN** previews are built on a single-step relearning card whose step has just started
- **THEN** Again and Hard read `<10m`, Good `1d` and Easy `4d`

#### Scenario: Hard part-way through a step

- **WHEN** previews are built three minutes into the same step
- **THEN** Again still reads `<10m`, because it restarts the step, and Hard reads `<7m`

#### Scenario: Hard after the step has run out

- **WHEN** previews are built eleven minutes into the same step
- **THEN** Hard reads `<1m`

Source: `lib/srs/intervalPreview.ts:6`, `lib/srs/intervalPreview.ts:19`, `lib/srs/intervalPreview.test.ts:31`, `lib/srs/intervalPreview.test.ts:105`.

### Requirement: Scheduler drift shows up in snapshots (baseline)

`lib/srs/eval.ts` SHALL replay five fixture histories through `nextReview` from a fixed start date, with
no use of the current time and default options, and the test suite SHALL snapshot each trace.

#### Scenario: A change alters an interval

- **WHEN** a change moves a scheduled day in a fixture
- **THEN** that fixture's snapshot test fails until the snapshot is regenerated

Source: `lib/srs/eval.ts:82`, `lib/srs/eval.ts:152`, `lib/srs/eval.test.ts:12`.

### Requirement: Projected days to first mastery (baseline)

`projectTimeToFirstMastery` SHALL simulate every graduated-or-lapsed, not yet mastered card under
always-Good for at most 50 steps, skip cards that never reach mastery in that cap, and return the
smallest result, rounded and at least 1. It SHALL return null days with no such card, or with the
`forceAllMastered` superuser flag on. The Stats caller runs it only while the player has introduced cards
and none mastered, and passes only the active locale's name cards and only the retention target.

#### Scenario: Superuser flag on

- **WHEN** `forceAllMastered` is true
- **THEN** the result is `{ days: null }`

#### Scenario: Card still in its first steps

- **WHEN** the only introduced card has null `lastReview`
- **THEN** it is skipped and the result is `{ days: null }`

Source: `lib/srs/timeToMastery.ts:37`, `lib/srs/timeToMastery.ts:61`, `lib/srs/timeToMastery.ts:99`, `lib/stats/dashboard-snapshot.ts:398`, `lib/stats/dashboard-snapshot.ts:419`, `lib/stats/dashboard-snapshot.ts:421`, `lib/srs/timeToMastery.test.ts:97`, `lib/srs/timeToMastery.test.ts:170`, `lib/srs/timeToMastery.test.ts:184`.

### Requirement: Optimiser input groups a player's reviews by card (baseline)

`gradeLogToOptimizerItems` SHALL skip entries without a subject key, group the rest by card type,
subject key and locale (a missing locale counts as "en"), sort each group by `occurredAt`, and map
grades 1, 2, 4, 5 to ratings 1, 2, 3, 4.

#### Scenario: Legacy entry

- **WHEN** an entry has no subject key
- **THEN** it is dropped

#### Scenario: Same card in two locales

- **WHEN** entries for one subject carry `en` and `ja`
- **THEN** they form separate items

Source: `lib/srs/optimizer.ts:28`, `lib/srs/optimizer.ts:57`, `lib/srs/optimizer.ts:64`, `lib/srs/optimizer.ts:77`, `lib/srs/optimizer.test.ts:56`, `lib/srs/optimizer.test.ts:92`, `lib/srs/optimizer.test.ts:124`, `lib/srs/optimizer.test.ts:154`.

### Requirement: Gaps between reviews are at least a day (baseline)

The first review of an item SHALL have `deltaT` 0 and each later one the gap in days, rounded, and at
least 1. An item needs a review with `deltaT` above 0, so a card with one review is dropped and a card
with two or more is kept, even when every review fell on one day. `countOptimizableReviews` counts
reviews by the same rule. Comments say "distinct days", and in-step grades are logged, so a same-day
learning touch counts as a one-day gap (#2254).

#### Scenario: One review only

- **WHEN** a card has a single review
- **THEN** it produces no item and is not counted

#### Scenario: Three grades in three minutes

- **WHEN** a card has three grades a minute apart
- **THEN** the item's gaps are 0, 1, 1 and all three reviews are counted

#### Scenario: A gap of a day and a half

- **WHEN** two reviews are 1.5 days apart
- **THEN** the second has `deltaT` 2

Source: `lib/srs/optimizer.ts:79`, `lib/srs/optimizer.ts:90`, `lib/srs/optimizer.ts:98`, `lib/srs/optimizer.ts:115`, `lib/srs/optimizer.ts:138`, `components/review/ReviewSession.tsx:2976`, `lib/srs/optimizer.test.ts:140`, `lib/srs/optimizer.test.ts:173`, `lib/srs/optimizer.test.ts:221`.

### Requirement: Who can run the optimiser (baseline)

`POST /api/srs/optimize` SHALL require a signed-in user, answering 401 otherwise. It SHALL fit only
when the fittable review count is at least 200, otherwise answer 422 `not_enough_reviews` with the
count. That count comes from the cloud grade log, so it can be lower than the local count on Settings;
the screen then asks the player to sync first. Guests see a sign-in prompt, and the button is disabled
during a superuser flag, a run, or a local fittable count under 200.

#### Scenario: Guest calls the route

- **WHEN** there is no session
- **THEN** the answer is 401

#### Scenario: Signed in, reviews not yet synced

- **WHEN** the cloud log has fewer than 200 fittable reviews
- **THEN** the answer is 422 with `reviewCount` and no fit runs

#### Scenario: Superuser flag on

- **WHEN** Settings renders with any superuser flag on
- **THEN** the button is disabled

#### Scenario: Too few local reviews

- **WHEN** the signed-in player's local fittable count is under 200
- **THEN** the button is disabled, the count shows and no request is sent

Source: `lib/srs/optimizer.ts:12`, `app/api/srs/optimize/route.ts:174`, `app/api/srs/optimize/route.ts:256`, `app/api/srs/optimize/route.ts:263`, `components/settings/FsrsOptimizerSection.tsx:84`, `components/settings/FsrsOptimizerSection.tsx:175`, `components/settings/FsrsOptimizerSection.tsx:183`, `components/settings/FsrsOptimizerSection.tsx:240`, `app/api/srs/optimize/route.test.tsx:227`, `app/api/srs/optimize/route.test.tsx:255`.

### Requirement: One optimiser run a week (baseline)

The route SHALL answer 429 `cooldown` with `retryAfterMs` and a `Retry-After` header in whole seconds
while the last successful run is under 7 days old. If its stored state cannot be read it SHALL answer
503 `service_unavailable`. Settings rounds the wait up to whole days, and blocks the button only while it
holds the last-run date, which `loadSettings` drops (#2248).

#### Scenario: Second run on day three

- **WHEN** the last run was 3 days ago
- **THEN** the answer is 429 and no grade log is read

#### Scenario: Stored state unreadable

- **WHEN** the read fails
- **THEN** the answer is 503 `service_unavailable`

#### Scenario: Settings just after a successful run

- **WHEN** a run succeeds and the page stays open
- **THEN** the button is disabled and shows the days left

#### Scenario: Settings after a reload

- **WHEN** the player reloads Settings two days after a successful run
- **THEN** no last-run date shows, the button is enabled and pressing it gives the retry-after error

Source: `lib/srs/optimizer.ts:13`, `app/api/srs/optimize/route.ts:194`, `app/api/srs/optimize/route.ts:203`, `components/settings/FsrsOptimizerSection.tsx:23`, `components/settings/FsrsOptimizerSection.tsx:103`, `components/settings/FsrsOptimizerSection.tsx:204`, `app/settings/page.tsx:967`, `app/api/srs/optimize/route.test.tsx:238`.

### Requirement: A running or failed fit blocks new runs for five minutes (baseline)

The route SHALL write an in-progress stamp before reading the grade log, and answer 429 `cooldown` with
`retryAfterMs` and a `Retry-After` header while a stamp is under 5 minutes old. The stamp is not cleared on any path, and the result of its write
is not checked. So a run ending in `not_enough_reviews`, `degenerate_data`, `reviews_unavailable`,
`save_failed` or `unknown` blocks a retry for 5 minutes, and Settings reports that wait as a day (#2250). The
route's own limit is 60 seconds.

#### Scenario: Retry after syncing

- **WHEN** a run answers 422 `not_enough_reviews` and the player retries at once
- **THEN** the answer is 429 `cooldown` with about 300,000 ms to wait

#### Scenario: Retry after six minutes

- **WHEN** a run failed and the stamp is over 5 minutes old
- **THEN** the run proceeds

Source: `app/api/srs/optimize/route.ts:27`, `app/api/srs/optimize/route.ts:133`, `app/api/srs/optimize/route.ts:219`, `app/api/srs/optimize/route.ts:235`, `components/settings/FsrsOptimizerSection.tsx:103`.

### Requirement: The route reads the whole grade log, without locale (baseline)

The route SHALL page through the grade log oldest first and answer 503 `reviews_unavailable` when that
fails. It selects no `locale`, so every entry is grouped as "en" and a card's reviews in two languages
are merged into one item, unlike the count on Settings (#2252).

#### Scenario: Over 1,000 rows

- **WHEN** a player has more rows than one page
- **THEN** all pages are read before the fit

#### Scenario: Two learning languages

- **WHEN** one card has cloud rows in `en` and `ja`
- **THEN** the fit sees a single item

Source: `app/api/srs/optimize/route.ts:74`, `app/api/srs/optimize/route.ts:84`, `app/api/srs/optimize/route.ts:87`, `app/api/srs/optimize/route.ts:93`, `app/api/srs/optimize/route.ts:243`, `app/settings/page.tsx:555`, `app/api/srs/optimize/route.test.tsx:217`.

### Requirement: Fit results and failures (baseline)

The route SHALL call the native binding with short-term mode on, only on the server. A throw from the
fit SHALL answer 422 `degenerate_data` with `reviewCount` and a detail of at most 200 characters.
Success SHALL save the weights through the `merge_user_settings` RPC and answer `{ weights, optimizedAt, reviewCount }`. A failed save SHALL answer
500 `save_failed`. Any other throw SHALL answer 500 `unknown` with such a detail.

#### Scenario: Binding rejects the data

- **WHEN** `computeParameters` throws
- **THEN** the answer is 422 `degenerate_data`, with the message as detail for an Error or a string, and
  "internal_error" for anything else or an empty message

#### Scenario: Save fails

- **WHEN** the RPC returns an error
- **THEN** the answer is 500 `save_failed`

Source: `lib/srs/optimizer.ts:5`, `app/api/srs/optimize/route.ts:117`, `app/api/srs/optimize/route.ts:150`, `app/api/srs/optimize/route.ts:151`, `app/api/srs/optimize/route.ts:156`, `app/api/srs/optimize/route.ts:269`, `app/api/srs/optimize/route.ts:292`, `app/api/srs/optimize/route.test.tsx:124`, `app/api/srs/optimize/route.test.tsx:152`, `app/api/srs/optimize/route.test.tsx:162`, `app/api/srs/optimize/route.test.tsx:189`.

### Requirement: Flip cards are graded by the player (baseline)

Flip cards SHALL be graded with the buttons, the keys 1, 2, 4 and 5, or a swipe (left Again, down Hard,
right Good, up Easy). The key 3 SHALL be an alias for Good, so it never reaches `nextReview` as grade 3.

#### Scenario: The 3 key

- **WHEN** the player presses 3 on a revealed flip card
- **THEN** `handleGrade` receives 4

Source: `components/review/ReviewSession.tsx:1706`, `components/review/ReviewSession.tsx:1709`, `lib/review/swipeGesture.ts:107`, `lib/review/swipeGesture.test.ts:97`.

### Requirement: Reverse cards and multiple choice grade themselves (baseline)

A reverse card SHALL grade Good on the right tile and Again on a wrong one. With the typed-entry setting
on, a name card in its learning phase (null `lastReview` or on a step) SHALL show multiple choice, graded
the same way after a 1.5 second hold, and a name card past it SHALL show typed entry. The
`forceCardsGraduated` superuser flag puts every name card past that phase. Neither gives Hard or Easy.
With the setting off, name cards are flip cards.

#### Scenario: Wrong tile on a reverse card

- **WHEN** the player taps a wrong tile
- **THEN** the card is graded Again

#### Scenario: Typed entry on, new name card

- **WHEN** the setting is on and a name card has null `lastReview`
- **THEN** multiple choice shows, and the right option is graded Good after the hold

#### Scenario: Typed entry on, graduated name card

- **WHEN** the setting is on and a name card has `lastReview` set and null `learningStep`
- **THEN** typed entry shows

Source: `components/review/ReviewSession.tsx:3301`, `components/review/ReviewSession.tsx:3357`, `components/review/ReviewSession.tsx:3362`, `components/review/ReviewSession.tsx:3366`, `components/review/MultipleChoiceNameCard.tsx:14`, `components/review/MultipleChoiceNameCard.tsx:138`, `components/review/MultipleChoiceNameCard.test.tsx:106`, `components/review/MultipleChoiceNameCard.test.tsx:114`.

### Requirement: English typed answers are normalised before comparing (baseline)

`normaliseInput` SHALL trim, lowercase, fold curly apostrophes to straight, drop the gender symbols, and
remove ASCII punctuation and whitespace. Accented letters SHALL stay, and no Unicode normalisation
runs, so a decomposed "é" differs from the composed seed name.

#### Scenario: Separator variants

- **WHEN** the input is "porygon z" against "Porygon-Z"
- **THEN** the grade is Good

#### Scenario: Missing accent

- **WHEN** the input is "flabebe" against "Flabébé"
- **THEN** the distance is 2 and the grade is Hard

Source: `lib/srs/typedEntryGrade.ts:24`, `lib/srs/typedEntryGrade.test.ts:21`, `lib/srs/typedEntryGrade.test.ts:29`, `lib/srs/typedEntryGrade.test.ts:37`, `lib/srs/typedEntryGrade.test.ts:66`, `lib/srs/typedEntryGrade.test.ts:207`.

### Requirement: Edit distance sets the typed grade (baseline)

A Levenshtein distance of 0 SHALL be Good, 1 or 2 Hard, and more Again, whatever the name's length.
Typed entry never gives Easy. Empty input after normalising SHALL be Again, as SHALL the skip button. On
a two-character name any wrong answer of one or two characters is therefore Hard (#2258). Typed
entry runs for name cards past their learning phase when the setting is on.

#### Scenario: Two-letter typo

- **WHEN** an English input is 2 edits from the name
- **THEN** the grade is Hard

#### Scenario: Whitespace only

- **WHEN** the input is only spaces
- **THEN** the grade is Again

#### Scenario: Wrong species on a two-character Chinese name

- **WHEN** the input is 拉达 against 波波
- **THEN** the distance is 2 and the grade is Hard

Source: `lib/srs/typedEntryGrade.ts:49`, `lib/srs/typedEntryGrade.ts:81`, `lib/srs/typedEntryGrade.ts:97`, `components/review/TypedEntryNameCard.tsx:130`, `components/review/ReviewSession.tsx:3366`, `lib/srs/typedEntryGrade.test.ts:107`, `lib/srs/typedEntryGrade.test.ts:160`, `lib/srs/typedEntryGrade.test.ts:165`.

### Requirement: Japanese and Chinese answers match the native name (baseline)

For `ja`, `zh-Hans` and `zh-Hant` both sides SHALL be trimmed, NFKC-folded, lowercased and stripped of
punctuation, symbols and whitespace, and for `ja` katakana SHALL fold to hiragana. The long vowel mark
stays. Simplified and traditional variants are not folded, so a one-character difference is a near
miss. English SHALL use the English path and ignore mode and transliteration.

#### Scenario: Hiragana for a katakana name

- **WHEN** the input is the hiragana form of a katakana name
- **THEN** the grade is Good in both modes

#### Scenario: Traditional input against a simplified name

- **WHEN** the input differs from a `zh-Hans` name by one variant character
- **THEN** the grade is Hard

#### Scenario: English with a transliteration supplied

- **WHEN** the locale is `en`
- **THEN** the result equals `gradeTypedAnswer`

Source: `lib/srs/typedEntryGradeLocale.ts:81`, `lib/srs/typedEntryGradeLocale.ts:152`, `lib/srs/typedEntryGradeLocale.ts:165`, `lib/srs/typedEntryGradeLocale.test.ts:52`, `lib/srs/typedEntryGradeLocale.test.ts:87`, `lib/srs/typedEntryGradeLocale.test.ts:96`, `lib/srs/typedEntryGradeLocale.test.ts:194`.

### Requirement: Lenient mode also accepts romanisation (baseline)

Lenient, the default, SHALL also compare against the pre-baked rōmaji or pinyin, ignoring tone, spacing
and case, and take the higher grade, then the smaller distance. Strict SHALL compare native script
only. With no transliteration, lenient SHALL fall back to native only. Stripping diacritics also folds
`ü` to `u`. Input empty under both normalisers SHALL be Again.

#### Scenario: Pinyin without tones

- **WHEN** toneless pinyin is typed in lenient mode
- **THEN** the grade is Good

#### Scenario: Rōmaji in strict mode

- **WHEN** `pikachu` is typed against ピカチュウ in strict mode
- **THEN** the grade is Again

Source: `lib/srs/typedEntryGradeLocale.ts:110`, `lib/srs/typedEntryGradeLocale.ts:161`, `lib/srs/typedEntryGradeLocale.ts:167`, `lib/srs/typedEntryGradeLocale.ts:178`, `lib/srs/typedEntryGradeLocale.test.ts:117`, `lib/srs/typedEntryGradeLocale.test.ts:131`, `lib/srs/typedEntryGradeLocale.test.ts:141`, `lib/srs/typedEntryGradeLocale.test.ts:175`.

### Requirement: Multiple-choice distractors (baseline)

`pickMcDistractors` SHALL pick up to three default-form species other than the target, same generation
first, then the rest, each group in a fixed hashed order from the seed and target id. A target with a
null generation has no same-generation group. The same inputs SHALL give the same result.

#### Scenario: Plenty in the generation

- **WHEN** the target's generation has three or more other default forms
- **THEN** all three distractors share its generation

#### Scenario: Alternate forms in the pool

- **WHEN** the pool includes non-default forms
- **THEN** none is picked

Source: `lib/srs/multipleChoiceDistractors.ts:29`, `lib/srs/multipleChoiceDistractors.ts:36`, `lib/srs/multipleChoiceDistractors.ts:47`, `lib/srs/multipleChoiceDistractors.test.ts:61`, `lib/srs/multipleChoiceDistractors.test.ts:67`, `lib/srs/multipleChoiceDistractors.test.ts:87`, `lib/srs/multipleChoiceDistractors.test.ts:94`, `lib/srs/multipleChoiceDistractors.test.ts:111`.

### Requirement: Multiple-choice options stay fixed per card (baseline)

`buildMcOptions` SHALL return the target and its distractors in an order fixed by the seed, and the
review screen SHALL pass the card id as seed, so a card shows the same options in the same order on
every replay. Positions are not even: across all 1,025 default species the correct answer lands in
positions 1 to 4 on 324, 167, 323 and 211 cards (#2260).

#### Scenario: Learning-step replay

- **WHEN** a card returns during its steps
- **THEN** its four options are in the same order

#### Scenario: Option set

- **WHEN** options are built from the full roster
- **THEN** there are four unique species with exactly one correct

Source: `lib/srs/multipleChoiceDistractors.ts:67`, `lib/srs/multipleChoiceDistractors.ts:85`, `components/review/ReviewSession.tsx:3373`, `lib/srs/multipleChoiceDistractors.test.ts:129`, `lib/srs/multipleChoiceDistractors.test.ts:146`, `lib/srs/multipleChoiceDistractors.test.ts:152`, `lib/srs/multipleChoiceDistractors.test.ts:158`.

### Requirement: Reverse-card distractors (baseline)

`pickDistractors` SHALL return `count` entries other than the target in a fixed hashed order, or, when
the pool holds `count` or fewer non-target entries, all of them in pool order. The reverse card asks for
three from the full seed with the card id as seed. It has no generation preference and no form filter,
so alternate forms can appear (#2262). Unlike multiple choice, its four tiles are shuffled at random on
each presentation, so a replay shows the same species in a new order.

#### Scenario: Small pool

- **WHEN** the pool has `count` or fewer non-target entries
- **THEN** all of them are returned without error, in pool order

#### Scenario: Re-render

- **WHEN** the same card renders again
- **THEN** the distractors are the same

#### Scenario: Learning-step replay of a reverse card

- **WHEN** a reverse card returns in the same session
- **THEN** the picker remounts with the same four species, and their order comes from `Math.random`

Source: `lib/pokemon/distractors.ts:14`, `lib/pokemon/distractors.ts:20`, `components/review/ReviewSession.tsx:3258`, `components/review/ReviewSession.tsx:3298`, `components/review/SpritePicker.tsx:93`, `components/review/SpritePicker.tsx:147`, `components/review/SpritePicker.test.tsx:158`, `lib/pokemon/distractors.test.ts:49`, `lib/pokemon/distractors.test.ts:57`, `lib/pokemon/distractors.test.ts:64`.

### Requirement: Five database card types (baseline)

`CARD_TYPES` SHALL be `name`, `reverse`, `cry`, `evolution-edge` and `reverse-evolution-edge`, and
`isValidCardType` SHALL accept only those.

#### Scenario: Unknown type

- **WHEN** `isValidCardType` gets another string
- **THEN** it returns false

Source: `lib/cards/subjectKey.ts:23`, `lib/cards/subjectKey.ts:30`, `lib/cards/subjectKey.ts:38`, `lib/cards/subjectKey.test.ts:14`, `lib/cards/subjectKey.test.ts:20`, `lib/cards/subjectKey.test.ts:27`.

### Requirement: Subject keys (baseline)

A species key SHALL be the positive integer id as a string, and an edge key SHALL be `from>>>to` with
both ids positive integers and order significant. The encoders SHALL throw on anything else, and the
parsers SHALL throw on any string that the encoders would not produce.

#### Scenario: Round trip

- **WHEN** `forEdge(133, 134)` is parsed by `parseEdge`
- **THEN** the result is `{ fromId: 133, toId: 134 }`

#### Scenario: Not canonical

- **WHEN** `parseSpecies` gets "01", "", "0" or an edge key
- **THEN** it throws

#### Scenario: Missing separator

- **WHEN** `parseEdge` gets "12"
- **THEN** it throws

Source: `lib/cards/subjectKey.ts:45`, `lib/cards/subjectKey.ts:76`, `lib/cards/subjectKey.ts:88`, `lib/cards/subjectKey.test.ts:52`, `lib/cards/subjectKey.test.ts:68`, `lib/cards/subjectKey.test.ts:86`, `lib/cards/subjectKey.test.ts:90`, `lib/cards/subjectKey.test.ts:108`, `lib/cards/subjectKey.test.ts:158`.

### Requirement: App and database card type names (baseline)

`evolution` and `reverse-evolution` SHALL map to `evolution-edge` and `reverse-evolution-edge` and back,
and the other three SHALL pass through. An unknown database type SHALL map to null.

#### Scenario: A newer client's type

- **WHEN** `dbTypeToAppType` gets an unknown value
- **THEN** it returns null

#### Scenario: Round trip

- **WHEN** an app type is mapped to the database and back
- **THEN** the original value returns

Source: `lib/cards/subjectKey.ts:113`, `lib/cards/subjectKey.ts:126`, `lib/cards/subjectKey.test.ts:184`, `lib/cards/subjectKey.test.ts:221`, `lib/cards/subjectKey.test.ts:227`.
