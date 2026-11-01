# stats-and-streaks Specification

## Purpose
The daily streak, the tokens that protect it, its milestones and its cloud sync, plus the Stats page and
the pure derivations behind it. This is the baseline: current behaviour on `qa` at d2456f44 (2 November
2026), written from code and tests, not what it should be. A requirement that records behaviour which
looks wrong says so and names the issue. Line references are to that commit. Cloud sync in general,
review queues, FSRS scheduling and the Journey page belong to other capabilities; only what this one
depends on appears here. Superuser flags are named in full; "species-mastered" means both legs mastered.

## Requirements

### Requirement: A streak day is recorded per user-local day (baseline)

The app SHALL add the player's timezone-local date to the streak list when today's graded count, including the current grade, reaches `STREAK_MIN_CARDS` (5), or when the due queue is empty. The list SHALL be a sorted, duplicate-free array of `YYYY-MM-DD` strings in localStorage under `poke-memory:streak:v1`, and a new date SHALL dispatch `poke-memory:streak-updated`. Corrupt or non-string stored data SHALL read as an empty list.

#### Scenario: Below the threshold with cards still due

- **WHEN** a player has graded 4 cards today and reviews remain due
- **THEN** no date is written and no event fires (`lib/streak/persistence.test.ts:120`, `:140`)

#### Scenario: Reaching the threshold

- **WHEN** the fifth grade of the day is recorded
- **THEN** the date is stored once, sorted, and the event fires once (`lib/streak/persistence.test.ts:125`, `:80`, `:104`)

#### Scenario: A light queue

- **WHEN** a grade leaves no due reviews, with fewer than 5 grades today
- **THEN** the day still counts (`lib/streak/persistence.test.ts:135`)

#### Scenario: Grading near midnight in a non-UTC timezone

- **WHEN** the UTC date and the player's local date differ
- **THEN** the local date is stored, while `dueDate` and `lastReview` comparisons stay UTC

#### Scenario: Undoing the grade that earned the day

- **WHEN** the player undoes the fifth grade of the day
- **THEN** the streak date stays, because only `recordReview` writes it in `ReviewSession` (looks wrong: #2279)

Source: `lib/streak/persistence.ts:7`, `lib/streak/persistence.ts:11`, `lib/streak/persistence.ts:13-25`, `lib/streak/persistence.ts:31-45`, `lib/storage/keys.ts:61`, `components/review/ReviewSession.tsx:2640`, `components/review/ReviewSession.tsx:2965-2972`, `components/review/ReviewSession.tsx:3068`.

### Requirement: The current streak counts back from today or yesterday (baseline)

`computeStreak` SHALL count consecutive dates back from today if today is present, otherwise from yesterday, and SHALL return 0 when neither is present. Order and duplicates SHALL NOT matter. Date arithmetic SHALL be UTC on the date string, so daylight saving has no effect. Every reader SHALL pass `effectiveStreakDates` (review dates plus spend dates) and a timezone-local today.

#### Scenario: Not reviewed yet today

- **WHEN** yesterday is present and today is not
- **THEN** the streak is still alive and counts from yesterday (`lib/streak/compute.test.ts:13`, `:31`)

#### Scenario: A gap

- **WHEN** the newest date is two days ago
- **THEN** the streak is 0 (`lib/streak/compute.test.ts:17`, `:88`)

#### Scenario: Daylight saving

- **WHEN** a run crosses a clock change
- **THEN** the count is unaffected (`lib/streak/compute.test.ts:63`, `:70`)

#### Scenario: Protected days count

- **WHEN** a missed day is in `spendDates`
- **THEN** it counts as a streak day (`lib/streak/tokens.test.ts:691`), but a stale spend alone does not start a streak (`:698`)

Source: `lib/streak/compute.ts:10-32`, `lib/streak/tokens.ts:413-420`, `lib/streak/useStreakNavState.ts:76-85`, `components/review/StreakBadge.tsx:77-89`, `app/journey/page.tsx:458-465`, `components/review/useShareSheet.ts:51`.

### Requirement: Streak dates sync as a one-way-growing set (baseline)

For signed-in players, `pushStreak` SHALL upsert every local date into `streak_days` with `ignoreDuplicates`, `pullStreak` SHALL page through all rows ordered by date, and `mergeStreak` SHALL union and sort, so sync never removes a date. Failures SHALL NOT interrupt anything. The database SHALL reject a date later than `current_date + 1`. Spend dates SHALL NOT go to `streak_days`; they travel in the settings blob.

#### Scenario: A new streak day on a signed-in device

- **WHEN** `poke-memory:streak-updated` fires
- **THEN** `AutoSyncOnChange` pushes the full local list, and a failure waits for the next new streak day

#### Scenario: A second device

- **WHEN** a pull finds dates this device lacks
- **THEN** the union is saved, the event fires and the session key is bumped so an open Stats page reloads (`lib/sync/pullAndMerge.ts:508-531`)

#### Scenario: Guest

- **WHEN** no user is signed in
- **THEN** dates stay on the device, because `AutoSyncOnChange` has no client to push with

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the page passes a null client and user to `useRetryPush`, cloud writes stay suppressed and pulls continue (`AGENTS.md:72`)

#### Scenario: Push and pull failures

- **WHEN** Supabase returns an error
- **THEN** push gives `false` and pull gives `null` (`lib/sync/streak.test.ts:64`, `:90`), and a pull orders by date before ranging (`:83`)

#### Scenario: Nothing to push

- **WHEN** the date list is empty
- **THEN** `pushStreak` returns `true` with no request (`lib/sync/streak.test.ts:57`)

Source: `lib/sync/streak.ts:15`, `lib/sync/streak.ts:18-36`, `lib/sync/streak.ts:38-60`, `lib/sync/streak.ts:65-68`, `components/sync/AutoSyncOnChange.tsx:81-90`, `db/migrations/021_streak_days_no_future_date.sql:25-27`, `app/stats/page.tsx:217-219`.

### Requirement: Tokens are earned for sustained reviewing (baseline)

On a run where today is a streak date and `lastEarnCheckDate` is not today, the step SHALL add one to `daysSinceLastEarn`, first resetting it to 0 if any day strictly between `lastEarnCheckDate` and today is neither a review day nor a spend day. At `EARN_INTERVAL_DAYS` (30) it SHALL add one token, capped at `MAX_BALANCE` (3), and reset the counter to 0. `earned` SHALL be true only when the balance rose.

#### Scenario: Earning at the threshold

- **WHEN** the counter reaches 30
- **THEN** a token is earned and the counter resets (`lib/streak/tokens.test.ts:114`)

#### Scenario: At the cap

- **WHEN** the balance is 3 and the counter reaches 30
- **THEN** the balance stays 3, the counter resets and `earned` is false, so no event is recorded (`lib/streak/tokens.test.ts:125`)

#### Scenario: Run several times in a day

- **WHEN** the step runs twice on one date
- **THEN** the counter moves once (`lib/streak/tokens.test.ts:106`, `lib/streak/runProtection.test.ts:141`)

#### Scenario: A broken run

- **WHEN** the player reviews again after an unbridged missed day
- **THEN** the counter restarts at 1 (`lib/streak/tokens.test.ts:147`)

#### Scenario: A bridged run

- **WHEN** the missed days were bridged by a spend
- **THEN** the counter carries on (`lib/streak/tokens.test.ts:170`, `:507`)

Source: `lib/streak/tokens.ts:31`, `lib/streak/tokens.ts:34`, `lib/streak/tokens.ts:321-353`, `lib/streak/tokens.ts:451-463`.

### Requirement: Tokens bridge missed days automatically, all or nothing (baseline)

The step SHALL walk back from yesterday over at most `MAX_BALANCE` days that are neither review nor spend days, and SHALL need a review or spend day just before them as an anchor. With an anchor and a balance covering the whole gap, it SHALL spend one token per gap day and add those days to `spendDates`; otherwise it SHALL spend nothing. Today need not be reviewed, consecutive spends SHALL be allowed, and one step SHALL record one event.

#### Scenario: One missed day

- **WHEN** yesterday is missing, the day before is alive and the balance is at least 1
- **THEN** yesterday is bridged (`lib/streak/tokens.test.ts:211`)

#### Scenario: A gap longer than the balance

- **WHEN** the gap is 3 days and the balance is 2
- **THEN** nothing is spent and the balance is kept (`lib/streak/tokens.test.ts:379`)

#### Scenario: No anchor

- **WHEN** there is no alive day before the gap
- **THEN** nothing is spent (`lib/streak/tokens.test.ts:389`, `lib/streak/runProtection.test.ts:218`)

#### Scenario: A spend day as the anchor

- **WHEN** the day before the gap is itself a spend day
- **THEN** it anchors the gap (`lib/streak/tokens.test.ts:398`)

#### Scenario: Offline with two devices

- **WHEN** this device has not pulled a review made yesterday on another device
- **THEN** yesterday looks missed and a token is spent for it, and merging the date afterwards refunds nothing (looks wrong: #2272)

#### Scenario: Superuser flag on

- **WHEN** a superuser flag is on and the app opens
- **THEN** the step still runs and saves to local settings, unlike the retroactive badge award on the same page (`app/stats/page.tsx:260`, `:315`)

Source: `lib/streak/tokens.ts:265-282`, `lib/streak/tokens.ts:291-313`, `lib/streak/tokens.ts:387-403`, `components/review/StreakBadge.tsx:82`.

### Requirement: The earn-then-spend step needs a null earn date (baseline)

After Phase 2, if a token was earned and Phase 1 spent nothing, the step SHALL run the same walk-back again and may spend the new token, recording one `earned-and-spent` event. Today this SHALL fire only if `lastEarnCheckDate` is null or the gap falls before it, because the Phase 2 reset otherwise clears the counter first. An `earned-and-spent` event SHALL also result when Phase 1 spends and Phase 2 earns in one step.

#### Scenario: The test fixture

- **WHEN** the balance is 0, the counter 29, `lastEarnCheckDate` null, and one day was missed
- **THEN** the token is earned and spent (`lib/streak/tokens.test.ts:542`, `:592`)

#### Scenario: A real player

- **WHEN** the same state has `lastEarnCheckDate` set to the day before the gap
- **THEN** nothing is earned or spent and the counter becomes 1, as a Node run of the function confirmed on 2 November 2026 (looks wrong: #2273)

#### Scenario: Phase 1 spends and Phase 2 earns

- **WHEN** a held token bridges the gap and the bridged run reaches 30
- **THEN** one `earned-and-spent` event is recorded (`lib/streak/tokens.test.ts:421`)

Source: `lib/streak/tokens.ts:229-234`, `lib/streak/tokens.ts:329-334`, `lib/streak/tokens.ts:364-385`, `lib/streak/tokens.ts:391-394`.

### Requirement: Protection state lives in settings and is parsed defensively (baseline)

`StreakProtection` SHALL live in the settings blob, so it follows settings sync. `validateStreakProtection` SHALL never throw: a malformed field SHALL fall back to its default, the balance SHALL clamp to `MAX_BALANCE`, `spendDates` SHALL keep only valid dates, sorted and unique, and malformed events SHALL be dropped. Events SHALL be capped at `MAX_PROTECTION_EVENTS` (10), dropping the oldest. `spendDates` SHALL have no cap.

#### Scenario: Corrupt state

- **WHEN** the stored value is not an object or holds bad fields
- **THEN** defaults are used per field (`lib/streak/tokens.test.ts:20`, `:31`, `:37`, `:48`)

#### Scenario: Event cap

- **WHEN** an eleventh event is added
- **THEN** the oldest is dropped (`lib/streak/tokens.test.ts:630`)

Source: `lib/streak/tokens.ts:37`, `lib/streak/tokens.ts:59-96`, `lib/streak/tokens.ts:113-187`, `lib/streak/tokens.ts:398-401`, `lib/settings/persistence.ts:426`, `lib/settings/persistence.ts:905`.

### Requirement: The protection step runs only on the client, with stored settings (baseline)

`runStreakProtection` SHALL return null on the server or when no settings record exists, and SHALL save only when balance, counter, `lastEarnCheckDate` or the `spendDates` length changed. It SHALL run on each `StreakBadge` refresh (mount, streak update, settings save) and on each Stats load, always for the timezone-local today. `useStreakNavState` SHALL only read.

#### Scenario: Fresh device

- **WHEN** no settings are stored
- **THEN** it returns null and creates none (`lib/streak/runProtection.test.ts:101`, `:107`)

#### Scenario: Nothing changed

- **WHEN** the step moves nothing
- **THEN** settings are not written (`lib/streak/runProtection.test.ts:128`)

#### Scenario: Stats visited on a missed-day morning

- **WHEN** Stats mounts on a day after a missed day
- **THEN** the spend is saved before the protection card renders, with no toast, because only `StreakBadge` shows toasts (`app/stats/page.tsx:257-260`)

Source: `lib/streak/runProtection.ts:40-64`, `components/review/StreakBadge.tsx:71-143`, `app/stats/page.tsx:255-260`, `lib/streak/useStreakNavState.ts:58-61`.

### Requirement: Streak milestones celebrate once per player (baseline)

Milestones SHALL be 3, 7, 14, 30, 60, 100, 150, 200, 250 and 365, then every 100 days from 465. `findPendingMilestone` SHALL return the smallest reached, unseen milestone. `StreakBadge`, on Practice only, SHALL show one at a time and add it to `seenStreakMilestones` on dismissal, so a milestone never repeats, even after a streak breaks and regrows.

#### Scenario: Dismissal and tiers

- **WHEN** a celebration shows
- **THEN** it dismisses after 4500 ms or on a tap (`components/streak/MilestoneCelebration.test.tsx:111`), with `light` under 30, `standard` under 365 and `major` from 365 (`lib/streak/milestones.test.ts:124`, `:130`, `:136`)

#### Scenario: A missed celebration

- **WHEN** several milestones are reached and unseen
- **THEN** the smallest is shown, and the next after dismissal (`lib/streak/milestones.test.ts:55`)

#### Scenario: Past 365

- **WHEN** the streak is 500 and 465 is unseen
- **THEN** 465 is returned (`lib/streak/milestones.test.ts:88`), and 400 returns null (`:83`)

#### Scenario: QA force flag

- **WHEN** `forceNextStreakMilestone` is on
- **THEN** the smallest unseen milestone fires whatever the streak, is not saved as seen, and the flag clears on dismissal (`components/review/StreakBadge.tsx:92-96`, `:156-163`)

#### Scenario: A non-English locale

- **WHEN** the UI is in `ja`, `zh-Hans` or `zh-Hant`
- **THEN** the celebration text is still English (looks wrong: #2278)

Source: `lib/streak/milestones.ts:9-11`, `lib/streak/milestones.ts:25`, `lib/streak/milestones.ts:34-38`, `lib/streak/milestones.ts:53-77`, `components/review/StreakBadge.tsx:91-99`, `components/review/StreakBadge.tsx:154-168`, `components/streak/MilestoneCelebration.tsx:45-71`, `components/streak/MilestoneCelebration.tsx:79-82`, `app/page.tsx:105`.

### Requirement: Streak state is read through one hook (baseline)

`useStreakNavState` SHALL return all nulls until read after mount, then the streak, token balance and days to the next milestone strictly above the streak, re-reading on streak and settings events. The countdown SHALL be null at streak 0 or while `forceNextStreakMilestone` is on.

#### Scenario: Streak zero

- **WHEN** there is no streak
- **THEN** the streak and balance are 0 and the countdown is null (`components/streak/useStreakNavState.test.tsx:139`)

#### Scenario: Just reached a milestone

- **WHEN** the streak equals a milestone
- **THEN** the countdown shows the next one (`components/streak/useStreakNavState.test.tsx:270`)

#### Scenario: Force flag

- **WHEN** `forceNextStreakMilestone` turns on
- **THEN** the countdown is null, and it returns when the flag turns off (`components/streak/useStreakNavState.test.tsx:193`, `:204`)

Source: `lib/streak/useStreakNavState.ts:39-50`, `lib/streak/useStreakNavState.ts:67-117`.

### Requirement: The Stats card shows the token state (baseline)

`StreakProtectionCard` SHALL show the balance, the earn rule, days to the next token unless at the cap, the last spend date and the last 3 events, newest first, refreshing on settings saves. It SHALL show a dismissible banner for the newest `earned-and-spent` event until that date is acknowledged. It SHALL NOT show the streak itself, which the profile status bar carries.

#### Scenario: Zero balance

- **WHEN** a fresh player opens Stats
- **THEN** the card renders with zero tokens (`components/stats/StreakProtectionCard.test.tsx:47`)

#### Scenario: Banner dismissed

- **WHEN** the player dismisses the banner
- **THEN** the date is saved and the banner hides (`components/stats/StreakProtectionCard.test.tsx:228`)

#### Scenario: After a broken run

- **WHEN** a run has broken but the player has not reviewed since
- **THEN** days to the next token still shows the old counter, which resets only on the next review day (looks wrong: #2273)

#### Scenario: A non-English locale

- **WHEN** the locale is `ja` or `zh-Hans`
- **THEN** heading and token labels are translated with plurals (`components/stats/StreakProtectionCard.test.tsx:356`, `:429`, `:453`)

Source: `components/stats/StreakProtectionCard.tsx:38-53`, `components/stats/StreakProtectionCard.tsx:61-64`, `components/stats/StreakProtectionCard.tsx:72-74`, `components/stats/StreakProtectionCard.tsx:76-86`, `components/stats/StreakProtectionCard.tsx:89`, `components/stats/StreakProtectionCard.tsx:134-146`.

### Requirement: Mastery is species-level with both legs (baseline)

A card SHALL be mastered at `stability >= 21`, not by reps. A species SHALL count as mastered only when its name and reverse cards in the same locale are both mastered. A card SHALL be `locked` with no `lastReview`, otherwise `learning` or `mastered`. A species with exactly one leg mastered SHALL be blocked, naming the other leg. A lapse below 21 SHALL revert mastery, as it is derived live.

#### Scenario: Exactly at the gate

- **WHEN** stability is 21.0, or 20.99
- **THEN** the card is mastered, or not (`lib/stats/derive.test.ts:240`, `:244`)

#### Scenario: One leg only

- **WHEN** the name leg is mastered and the reverse is not
- **THEN** the species is not mastered and is blocked on `reverse` (`lib/stats/dashboard-snapshot.test.ts:692`, `lib/stats/legStatus.test.ts:143`)

#### Scenario: A leg in another locale

- **WHEN** the reverse leg is mastered only in another locale
- **THEN** it does not complete the species (`lib/stats/per-game.test.ts:285`, `lib/stats/legStatus.test.ts:242`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** every species reads as mastered and none is blocked (`lib/stats/legStatus.test.ts:193`)

Source: `lib/stats/derive.ts:33`, `lib/stats/derive.ts:76-78`, `lib/stats/derive.ts:85-89`, `lib/stats/derive.ts:296-303`, `lib/stats/legStatus.ts:102-133`, `lib/stats/mastery-species-events.ts:57-113`.

### Requirement: One pure snapshot feeds Stats and Journey (baseline)

`computeDashboardSnapshot` SHALL be pure and SHALL compute queue, forecast, mastery, struggling, projection, first-mastery and difficulty axes, setting any axis left out of `include` to null. `DashboardSnapshotProvider` SHALL memoise it by input, held in one slot that a page fills on mount and clears on unmount. Stats SHALL pass a UTC today, because card dates are UTC. Reading the context outside the provider SHALL throw.

#### Scenario: Selecting axes

- **WHEN** `include` lists some axes
- **THEN** the others are null, and omitting it computes all (`lib/stats/dashboard-snapshot.test.ts:955`, `:983`)

#### Scenario: Active language

- **WHEN** a locale is passed
- **THEN** mastery follows it (`lib/stats/dashboard-snapshot.test.ts:1178`)

#### Scenario: Superuser flag on

- **WHEN** `forceAllMastered` is true
- **THEN** queue and forecast keep real scheduling state (`lib/stats/dashboard-snapshot.test.ts:1032`)

Source: `lib/stats/dashboard-snapshot.ts:234-250`, `lib/stats/dashboard-snapshot.ts:440-450`, `components/stats/DashboardSnapshotContext.tsx:62-84`, `components/stats/DashboardSnapshotContext.tsx:94-98`, `components/stats/DashboardSnapshotContext.tsx:108-116`, `app/stats/page.tsx:404-413`.

### Requirement: The due forecast covers 14 days (baseline)

The forecast SHALL have 14 entries from today. Entry 0 SHALL be the session queue total, with caps, eligibility and locale applied. Entries 1 to 13 SHALL count eligible, active-locale, already-reviewed cards of every type whose `dueDate` matches, without caps. The page SHALL show each bar as a button with a tap, hover or keyboard popup.

#### Scenario: Today's bar

- **WHEN** new and review cards exist
- **THEN** entry 0 equals the queue total (`lib/stats/dashboard-snapshot.test.ts:317`, `:626`)

#### Scenario: A disabled type or out-of-scope card

- **WHEN** a card is ineligible
- **THEN** it is left out of future bars (`lib/stats/dashboard-snapshot.test.ts:554`, `:580`)

#### Scenario: New cards

- **WHEN** a card was never reviewed
- **THEN** it is not in a future bar (`lib/stats/dashboard-snapshot.test.ts:605`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** the forecast stays real (`lib/stats/dashboard-snapshot.test.ts:1032`)

Source: `lib/stats/derive.ts:199`, `lib/stats/dashboard-snapshot.ts:305-357`, `components/stats/DueForecast.tsx:155-167`, `e2e/stats.spec.ts:206`, `e2e/stats.spec.ts:270`.

### Requirement: Struggling cards need evidence (baseline)

The list SHALL hold introduced name cards of the active locale with at least 3 reps and either a lapse or difficulty of 7 or more, sorted by difficulty descending, then fewer reps, then lower id, capped at 10. Rows SHALL show a derived legacy ease factor clamped to 1.3 to 2.5, and SHALL link to the Pokédex. The list SHALL be empty under `pretendAllMastered`.

#### Scenario: Ordering and cap

- **WHEN** more cards qualify than the limit
- **THEN** the hardest come first and the list is cut (`lib/stats/dashboard-snapshot.test.ts:748`, `:780`)

#### Scenario: None qualify

- **WHEN** nothing qualifies
- **THEN** the empty message shows, translated (`app/stats/page.test.tsx:371`, `:411`)

#### Scenario: A non-English locale

- **WHEN** the UI is not English
- **THEN** the row's "Ease factor" and "Reps" stay English (looks wrong: #2278)

Source: `lib/stats/derive.ts:50`, `lib/stats/derive.ts:62`, `lib/stats/derive.ts:376-402`, `lib/stats/derive.ts:417-439`, `app/stats/page.tsx:146-179`.

### Requirement: Completion projection extrapolates a trailing rate (baseline)

`computeCompletionProjection` SHALL return `complete` when no species remain or under `pretendAllMastered`, and `insufficient-history` when no mastery event falls in the trailing 28 days, the earliest in that window is under 7 days old, or the estimate exceeds 3650 days. Otherwise it SHALL return `projected`, with a weekly rate of events per day of history times 7. An event's date SHALL be the later `lastReview` of the two legs.

#### Scenario: Under 7 days of history

- **WHEN** the earliest event in the window is under 7 days old
- **THEN** the result is `insufficient-history` (`lib/stats/completion-projection.test.ts:207`), and exactly 7 days projects (`:217`)

#### Scenario: Too far away

- **WHEN** the estimate exceeds the cap
- **THEN** the result is `insufficient-history` (`lib/stats/completion-projection.test.ts:227`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** the result is `complete` (`lib/stats/completion-projection.test.ts:119`)

#### Scenario: An established player re-reviews old species

- **WHEN** mastered species are reviewed inside the window
- **THEN** each counts as a new mastery event and the rate rises (looks wrong: #2281)

Source: `lib/stats/completion-projection.ts:41`, `lib/stats/completion-projection.ts:53`, `lib/stats/completion-projection.ts:61`, `lib/stats/completion-projection.ts:88-170`, `lib/stats/mastery-species-events.ts:103-108`.

### Requirement: First-mastery hint shows before the first mastery (baseline)

The snapshot SHALL give a projected day count only when the active locale has introduced cards, none mastered and `pretendAllMastered` is off, and the page SHALL render the hint only then.

#### Scenario: Nothing mastered yet

- **WHEN** cards are introduced and none mastered
- **THEN** a positive day count is given (`lib/stats/dashboard-snapshot.test.ts:860`), shown by `e2e/stats.spec.ts:302`

#### Scenario: Something mastered

- **WHEN** a card is mastered
- **THEN** the value is null and the hint hides (`lib/stats/dashboard-snapshot.test.ts:851`, `e2e/stats.spec.ts:359`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** the hint hides (`e2e/stats.spec.ts:453`)

Source: `lib/stats/dashboard-snapshot.ts:395-428`, `app/stats/page.tsx:569-574`, `components/stats/FirstMasteryHint.tsx:35-51`.

### Requirement: Accuracy and recall treat Good and Easy as a pass (baseline)

Accuracy SHALL be grades 4 and 5 over all grades over a window of days, aggregated rather than averaged per day, and null for an empty window. The Stats page SHALL offer 7, 30 and 365-day windows. Recall vs target SHALL compare the 365-day figure with the settings target, reporting the delta and review count, and SHALL ignore `pretendAllMastered`. Grades SHALL be Again 1, Hard 2, Good 4, Easy 5.

#### Scenario: Per-day figures

- **WHEN** a day has grades 4, 5 and 1
- **THEN** accuracy is 2/3, and a day with no reviews is null (`lib/stats/accuracy.test.ts:27`, `:22`)

#### Scenario: Weighted window

- **WHEN** days have different volumes
- **THEN** rolling accuracy weights by review (`lib/stats/accuracy.test.ts:62`)

#### Scenario: No reviews

- **WHEN** the window is empty
- **THEN** `actual` and `delta` are null and the empty state shows (`lib/stats/retention.test.ts:15`)

#### Scenario: Hard grades

- **WHEN** a player grades Hard
- **THEN** it counts as a failed recall, although FSRS counts it as remembered in the target (looks wrong: #2275)

Source: `lib/stats/accuracy.ts:5`, `lib/stats/accuracy.ts:26-55`, `lib/stats/accuracy.ts:64-78`, `lib/stats/retention.ts:11`, `lib/stats/retention.ts:46-70`, `components/stats/AccuracySparkline.tsx:15`, `components/stats/RetentionIndicator.tsx:63-66`, `lib/srs/scheduler.ts:156-159`.

### Requirement: Grade and direction charts come from the grade log (baseline)

The grade mix SHALL count Again, Hard, Good and Easy across the log. The trend SHALL cover the 12 complete Monday-start weeks before the current one, trimmed of leading empty weeks. The direction breakdown SHALL have a row for all five directions, marking disabled ones, with name and reverse always enabled.

#### Scenario: The current week

- **WHEN** every entry is in the current week
- **THEN** the trend is empty (`lib/stats/grade-distribution.test.ts:110`)

#### Scenario: Monday

- **WHEN** today is a Monday
- **THEN** the last slot is the previous week (`lib/stats/grade-distribution.test.ts:208`)

#### Scenario: Empty log

- **WHEN** there are no entries
- **THEN** every direction has zero totals and null accuracy (`lib/stats/direction-breakdown.test.ts:26`)

Source: `lib/stats/grade-distribution.ts:27-43`, `lib/stats/grade-distribution.ts:92-155`, `lib/stats/direction-breakdown.ts:10-16`, `lib/stats/direction-breakdown.ts:50-77`, `lib/stats/direction-breakdown.ts:87-100`, `app/stats/page.tsx:408-418`.

### Requirement: Activity figures cover about a year of local days (baseline)

The heatmap SHALL be 53 weeks of 7 days ending with the current week, Sunday-first on Stats, with intensity buckets at 0, under 10, under 50, under 100 and 100 or more. Activity history SHALL be one row per day for 365 days, oldest first, with reviews and first-time introductions by `subjectKey`, judged across the whole log. Both SHALL ignore `pretendAllMastered`, and both SHALL use timezone-local days.

#### Scenario: Outside the window

- **WHEN** an entry is older than the grid
- **THEN** it is dropped (`lib/stats/heatmap.test.ts:27`)

#### Scenario: Introduced before the window

- **WHEN** a card first appears before the window
- **THEN** it is not counted as introduced (`lib/stats/activity-history.test.ts:89`)

#### Scenario: Legacy entries

- **WHEN** an entry has no `subjectKey`
- **THEN** it counts as a review, not an introduction (`lib/stats/activity-history.test.ts:113`)

#### Scenario: Guest

- **WHEN** a guest's log has been pruned to 365 days
- **THEN** a card first seen before that can count as introduced again, as the code comment records (`lib/stats/activity-history.ts:42-50`)

Source: `lib/stats/heatmap.ts:19-54`, `lib/stats/heatmap.ts:61-67`, `lib/stats/activity-history.ts:57-126`, `app/stats/page.tsx:419`, `app/stats/page.tsx:520-522`, `components/review/ReviewSession.tsx:2977`.

### Requirement: Difficulty counts every introduced card (baseline)

The histogram SHALL have nine fixed buckets from 1 to 10 by floor of difficulty, clamped at both ends, over cards with a `firstSeen` of every type and every locale. The mean SHALL be null with no cards. Under `pretendAllMastered` all counts SHALL be 0 and the mean null.

#### Scenario: Buckets

- **WHEN** introduced cards exist
- **THEN** they fall in the floor bucket (`lib/stats/difficulty-histogram.test.ts:93`), always in nine buckets (`:72`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** the population is treated as empty (`lib/stats/difficulty-histogram.test.ts:120`, `:143`)

#### Scenario: Two learning languages

- **WHEN** a player learns two languages
- **THEN** both are in the histogram, beside active-language mastery (looks wrong: #2276)

Source: `lib/stats/difficulty-histogram.ts:21-31`, `lib/stats/difficulty-histogram.ts:38-53`, `lib/stats/difficulty-histogram.ts:64-83`, `lib/stats/difficulty-histogram.ts:95-108`, `lib/stats/dashboard-snapshot.ts:433-437`.

### Requirement: Mastery history and records are derived from lastReview (baseline)

Mastery over time SHALL be a cumulative series with one point per mastery-event date, and a single point at today under `pretendAllMastered`. `computeRecords` SHALL give the longest run, best review day, average days from first sighting to mastery and the most mastered in any 7-day span, the last two null with no events. Records SHALL render on Journey, not Stats, with effective streak dates.

#### Scenario: No species mastered

- **WHEN** no species has both legs mastered
- **THEN** the series is empty and the empty state shows (`lib/stats/mastery-over-time.test.ts:137`)

#### Scenario: Two learning languages under the flag

- **WHEN** `pretendAllMastered` is on with two locales
- **THEN** only the active locale's name cards count (`lib/stats/mastery-over-time.test.ts:310`)

#### Scenario: Records under the flag

- **WHEN** `pretendAllMastered` is on
- **THEN** longest run and best day stay real (`lib/stats/records.ts:101-107`)

#### Scenario: Consistent across surfaces

- **WHEN** one species has both legs mastered
- **THEN** stats, events, history, records and projection all agree (`lib/stats/mastery-species-contract.test.ts:153`, `:174`, `:179`)

#### Scenario: A mastered species is reviewed

- **WHEN** a species mastered long ago is reviewed again
- **THEN** its date moves to that review (looks wrong: #2281)

Source: `lib/stats/mastery-over-time.ts:45-88`, `lib/stats/records.ts:33-56`, `lib/stats/records.ts:59-68`, `lib/stats/records.ts:89-157`, `app/journey/page.tsx:453-462`, `app/journey/page.tsx:610-620`, `app/journey/page.tsx:720`, `e2e/stats.spec.ts:187`.

### Requirement: Per-game and per-language breakdowns (baseline)

Per-game stats SHALL count default-form species listed under each game, with active-locale cards, and the Progress section SHALL hide when there are none. The Languages section SHALL render only with more than one enrolled locale, each row showing card count, mastery percentage and last review for that locale, in rows that use `computeStats` per locale.

#### Scenario: One language

- **WHEN** one locale is enrolled
- **THEN** the section does not render (`components/stats/LanguageBreakdown.test.tsx:157`)

#### Scenario: A locale never reviewed

- **WHEN** a locale has no reviews
- **THEN** its row says so (`components/stats/LanguageBreakdown.test.tsx:238`)

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** rows show 100% (`components/stats/LanguageBreakdown.test.tsx:308`, `lib/stats/per-game.test.ts:198`)

Source: `lib/stats/per-game.ts:59-124`, `app/stats/page.tsx:361-369`, `app/stats/page.tsx:540-547`, `components/stats/LanguageBreakdown.tsx:111-128`, `components/stats/LanguageBreakdown.tsx:173-188`.

### Requirement: The Stats page loads local data, then overlays the cloud (baseline)

The client page SHALL show a skeleton until a snapshot exists, then the Accuracy, Activity, Progress, Languages and Scheduling sections, charts loading lazily. It SHALL read settings, session and grade log locally, recompute on storage version changes, and silently award badges unless a superuser flag is on. For a signed-in player with no flag on, it SHALL then replace card state in memory with `applyCloudAuthoritative`, without saving.

#### Scenario: Signed in

- **WHEN** a user is signed in
- **THEN** the sync line shows, and a restore link when no superuser flag is on (`app/stats/page.tsx:437-446`, `:454-464`)

#### Scenario: Loading

- **WHEN** the page opens
- **THEN** the skeleton shows, then the section headings (`app/stats/page.test.tsx:325`)

#### Scenario: Guest

- **WHEN** no user is signed in
- **THEN** local data is used, the nudge shows unless `pretendAllMastered` is on, and no cloud read happens (`app/stats/page.tsx:336`, `:466`)

#### Scenario: Cloud read fails while offline

- **WHEN** `pullSession` throws or returns null
- **THEN** local cards stay (`app/stats/page.tsx:339`, `:349-351`)

#### Scenario: Grades not yet pushed

- **WHEN** this device holds grades the cloud lacks
- **THEN** card figures omit them while grade-log charts include them (looks wrong: #2274)

#### Scenario: A non-English locale

- **WHEN** the page renders in Japanese
- **THEN** section headings are translated (`app/stats/page.test.tsx:380`), but parts of the charts are not (looks wrong: #2278)

Source: `app/stats/page.tsx:124-138`, `app/stats/page.tsx:247-356`, `app/stats/page.tsx:437-473`, `app/stats/page.tsx:475-591`, `lib/sync/cloud.ts:727-741`.

### Requirement: The sync line reports the worst state first (baseline)

`SyncStatusLine` SHALL show, in priority order, a schema error, a retry in progress, a failed retry, cards out of sync or sync failed with a retry button, then last synced in the player's timezone or not synced yet. Retry buttons SHALL be disabled while a superuser flag is on. Zero failed cards SHALL read as synced.

#### Scenario: Failed cards

- **WHEN** the last push failed for some cards
- **THEN** the count, time and a retry button show (`components/stats/SyncStatusLine.tsx:145-160`)

#### Scenario: Superuser flag on

- **WHEN** a flag is on
- **THEN** the retry button is disabled with a reason (`components/stats/SyncStatusLine.tsx:131-134`)

Source: `components/stats/SyncStatusLine.tsx:47-78`, `components/stats/SyncStatusLine.tsx:86-125`, `components/stats/SyncStatusLine.tsx:127-163`, `components/stats/SyncStatusLine.tsx:166-171`.

### Requirement: Numbers count up unless reduced motion is on (baseline)

`useCountUp` SHALL animate over 600 ms with a cubic ease to its target, starting from the current figure when the target changes, and SHALL jump straight to it under `prefers-reduced-motion`. It SHALL return 0 at once for a target of 0.

#### Scenario: Reduced motion

- **WHEN** the player prefers reduced motion
- **THEN** the target shows immediately (`components/stats/useCountUp.test.tsx:36`)

#### Scenario: A changed target

- **WHEN** the target changes mid-way
- **THEN** the animation continues from the shown value (`components/stats/useCountUp.test.tsx:75`)

Source: `lib/stats/useCountUp.ts:17-65`.

## Clarifications

Open calls from writing this baseline on 2 November 2026, for the owner. Nothing here was answered by the owner; each has a recommendation.

- 2026-11-02: Where should this spec sit? It is directly in `openspec/specs/`, not a change folder, because a baseline alters no behaviour and other wave 3 baselines do the same. Recommendation: keep it.
- 2026-11-02: Should the requirements marked "looks wrong" stay as they are? Recommendation: yes, a baseline records today; each fix modifies the requirement in its own change (#2272 to #2276, #2278, #2279, #2281).
- 2026-11-02: Should the superuser flag stop the protection step saving? It writes local settings while the badge award on the same page is guarded, and `docs/superuser.md` only rules out cloud writes. Recommendation: no issue filed; decide when superuser mode is next specified.
- 2026-11-02: Should Records and the review surfaces (`StreakBadge`, Journey, the nudge route) move here or stay out? They were only described where this capability depends on them. Recommendation: keep `StreakBadge` here for milestones, and the nudge route with push.
- 2026-11-02: Existing oddities not repeated as new issues: #2193 covers the unused `computeStats` forecast and the UTC or local today seam.
- 2026-11-02: Verification was by reading code and tests, plus a Node run of the real `applyProtectionStep`. The unit, end-to-end and integration suites were not run for this baseline, and no UI was opened.
