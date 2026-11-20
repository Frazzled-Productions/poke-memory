## Context

Baseline written from code and tests on 2026-10-26 (`qa` at d6848e4c) and folded into the
`review-queue` delta. PR #2189 (#2187) is not merged yet; this change builds on it.

## Decisions

### Retrievability helper

`retrievabilityAt(card, today)` in `lib/srs/scheduler.ts`, built on the private `toFsrsCard` and
`getScheduler`, calls `ts-fsrs` `get_retrievability` with the player's scheduler parameters at the
start of the UTC day (`lastReview` is a date only). `buildSessionQueues` takes a precomputed
`Map<cardId, number>` so it stays pure and cheap. The grade-to-next-card timing budget (250 ms
median, `e2e/practice-grade-timing.spec.ts`) must hold: the map is computed once per session load,
not per grade.

### Total cap and split

The return-mode cap is applied after the per-direction slices: totals per direction are allocated
by largest remainder in proportion to due counts, each clamped to that direction's own cap. Pure
helper `returnModeCap(studyDays)` returns 20, 40, 80 or `null` (ended).

### State

Scalars only (`returnModeEnabled`, `returnModeStartedOn`, `returnModeStudyDays`), per the #2187
deep-merge lesson. `keepDeviceFavouriteKeys` (from #2189) is generalised to a list of "new keys"
so pulls keep device values the cloud lacks and never push defaults. Study days are counted when the
first review of a UTC day is graded during return mode.

### Postpone

`postponeForReturn(cards, todayIds, retrievability)` returns new `dueDate`s only: for overdue cards
not admitted today, sorted by retrievability then stability, `dueDate += floor(0.15 *
scheduledDays)` days (skip when 0). It reuses the save and push path the scope snooze uses
(`reconcileHiddenState`'s caller in `ReviewSession`), so pushes go through the existing card upsert.

### Push route

`app/api/push/send-daily/route.ts` reads the three keys from the settings row it already loads; in
return mode its count is the day's remaining goal (cap minus reviews done today), not the due total.

## Hook locations (from the baseline)


- **Retrievability order:** `buildSessionQueues`, `lib/review/session.ts:719`. Replace
  `shuffle(reviewCandidatesByType[type]).slice(0, reviewSlots)` with "sort by retrievability
  descending, then slice". The reshuffle of the merged queue at `lib/review/session.ts:851`
  (`shuffle(reviewQueue)`) also has to change, or the serving order goes back to random;
  `getNextCardId` (`lib/review/session.ts:879`) serves `reviewQueue[0]`. (The brief's "shuffle at
  about line 744" is these two lines; 744 is inside the new-card comment block.)
  `buildSessionQueues` takes no `now`, FSRS weights or retention today, so it needs a new
  parameter (or a precomputed retrievability map). The FSRS card conversion is private
  (`toFsrsCard`, `lib/srs/scheduler.ts:185`, plus `getScheduler`, `lib/srs/scheduler.ts:96`), so
  the natural home is a new exported helper in `lib/srs/scheduler.ts`. Because `lastReview` is a
  date only, elapsed time is measured from UTC midnight. Callers to keep in step:
  `ReviewSession.tsx:1734`, `1912`, `2647` and the load call at `1457`, plus
  `computeQueueCountFromEligible` (`lib/stats/dashboard-snapshot.ts:172`; it passes salt `""`).
- **`get_retrievability` is not imported anywhere.** `ts-fsrs` 5.4.2 is installed and exposes
  `get_retrievability(card, now, format)`. The only other `ts-fsrs` import is
  `lib/timeline/reconstruct.ts:31` (`computeDecayFactor`, `generatorParameters`), which works out
  its own power-law curve with default weights, not the player's.
- **Return-mode total cap:** in `buildSessionQueues` between the per-bucket loop
  (`lib/review/session.ts:713-721`) and the merge reshuffle (`lib/review/session.ts:851`): split a
  total budget across buckets in proportion to each bucket's candidates, then slice. The UI side
  has to follow: `resolveEndState` (`components/review/ReviewSession.tsx:2117-2122`) only knows
  per-bucket caps, so a total cap needs its own wall condition there, and the `extendedReview`
  uncapping (`ReviewSession.tsx:1726-1733`, `1893-1900`) is the existing "keep going" path. Limits
  enter through `limitsFromSettings` (`ReviewSession.tsx:181`).
- **New cards paused:** `remainingNew` in `lib/review/session.ts:749-754` (setting it to zero
  empties the new queue). The `NEW_CARDS_LOCKED` check (`ReviewSession.tsx:2124-2129`) would then
  not fire, because `newIntroducedToday` would be below the cap.
- **Gap detection:** nothing computes "days since last review" today. Possible sources: the latest
  card `lastReview` (UTC, synced through `card_reviews.last_review`, so it works across devices),
  the latest grade-log date (local day, every grade), or the latest streak date (local day,
  qualifying days only).
- **Bounded postpone:** the only precedent is the scope snooze in `reconcileHiddenState`
  (`lib/review/filters.ts:66-101`), which shifts `dueDate` and saves on load (it is gated on
  `changed`).
- **Hiding the backlog total:** the raw backlog reaches the player through the language switcher
  badge (`ReviewSession.tsx:325-352`) and the daily push (`send-daily/route.ts:748-800`). The
  practice counter, app-icon badge, title prefix and Stats day-0 bar already show capped figures.
  The decision "Stats still shows it" does not match today: Stats shows no raw backlog figure.

## Risks

- **Ordering cost per load** (about 1025 to 3000 cards): one pass computing retrievability is
  O(n); checked by the timing e2e.
- **A run of easy cards** may feel too easy; the most-forgotten wait longer. This is the owner's
  choice and is reversible.
- **Push copy** must stay neutral in return mode (Children's Code Standard 13).
