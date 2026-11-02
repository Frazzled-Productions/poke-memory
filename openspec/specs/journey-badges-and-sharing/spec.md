# journey-badges-and-sharing Specification

## Purpose
What a player sees of their long-term progress: the Journey page and its sections, gym badges, the
collection timeline, the daily and milestone share paths, and the status bar with its local caches.
This is the baseline: current behaviour on `qa` at d2456f44, written from code and tests, not what it
should be. A requirement that records behaviour which looks wrong says so and names the issue. Line
references are to that commit. Streak rules, records, the trainer card and the mastery snapshot itself
belong to stats-and-streaks; the pull and merge belong to cloud-sync.

## Requirements

### Requirement: Journey page load order (baseline)

The Journey page SHALL wait for the seed, then read settings, load the saved session or build a fresh
one, persist any healed cards, read streak and grade log, and show a loading skeleton until both the
mastery snapshot and the current streak exist. The load SHALL re-run when the stored session, any-flag
state, Supabase client, user or seed changes, and not on a settings save, which looks wrong (#2339).
Metadata SHALL title the route "Journey - Poké Memory".

#### Scenario: Seed not ready

- **WHEN** the seed is still null
- **THEN** nothing loads and the page shows only its heading and the skeleton

#### Scenario: Saved session needs healing

- **WHEN** `hydrateSession` reports `anyHealed`
- **THEN** the healed cards are saved before the page uses them

#### Scenario: Language switched on the page

- **WHEN** the player switches language in the status bar while on Journey
- **THEN** the status bar, language breakdown and Pokémon names change, and the snapshot, timeline, close-to-mastery list, next-badge hint and records stay on the old language until the page remounts (#2339)

Source: `app/journey/layout.tsx:3`, `app/journey/page.tsx:424`, `app/journey/page.tsx:427`, `app/journey/page.tsx:435`, `app/journey/page.tsx:443`, `app/journey/page.tsx:560`, `app/journey/page.tsx:627`.

### Requirement: Journey reads the cloud for signed-in players (baseline)

For a signed-in player with no superuser flag on, the page SHALL show local cards first, then replace
them for display with `applyCloudAuthoritative` over `pullSession`. It SHALL NOT save those cards. A
failed pull SHALL log a warning and keep local cards. The timeline, evolution wall and close-to-mastery
list SHALL use the final set; the retroactive badge check SHALL already have run on the local set.

#### Scenario: Guest

- **WHEN** `user` is null
- **THEN** no cloud read happens and every section uses local cards

#### Scenario: Offline, signed in

- **WHEN** `pullSession` throws
- **THEN** the page warns in the console and renders from local cards

#### Scenario: Superuser flag on

- **WHEN** any flag is on
- **THEN** no cloud read happens

Source: `app/journey/page.tsx:498`, `app/journey/page.tsx:500`, `app/journey/page.tsx:515`, `app/journey/page.tsx:533`, `app/journey/page.tsx:544`, `app/journey/page.tsx:551`.

### Requirement: Journey page sections and order (baseline)

The page SHALL render three titled groups in order. Your progress: trainer card, guest nudge, milestone
banner, timeline, current streak, records. Collection: evolution wall, close to mastery, badges.
Breakdown: mastery rings, mastery explainer, introduced ring, generation, type and language breakdowns.
Timeline, evolution wall and close to mastery SHALL each hold a skeleton slot until their data lands.

#### Scenario: Timeline still loading

- **WHEN** the snapshot exists but `timeline` is null
- **THEN** the timeline heading and a 200px skeleton hold the slot, so nothing shifts when data lands

#### Scenario: No streak

- **WHEN** the current streak is 0
- **THEN** the streak section shows the no-streak message, not a zero count

Source: `app/journey/page.tsx:638`, `app/journey/page.tsx:688`, `app/journey/page.tsx:704`, `app/journey/page.tsx:729`, `app/journey/page.tsx:759`, `app/journey/page.tsx:761`, `app/journey/page.tsx:786`, `app/journey/page.test.tsx:269`.

### Requirement: Journey streak and day boundaries (baseline)

The current streak SHALL count token-protected days and use today in the player's timezone (`UTC` when
unset). The snapshot and language breakdown SHALL use the UTC date.

#### Scenario: A protected day

- **WHEN** a token bridged a missed day
- **THEN** the current streak and the longest-streak record both count it

Source: `app/journey/page.tsx:458`, `app/journey/page.tsx:463`, `app/journey/page.tsx:576`, `app/journey/page.tsx:829`.

### Requirement: Guest nudge and mastery explainer on Journey (baseline)

The sign-up nudge SHALL be offered only with no user and `pretendAllMastered` off, and receives the
mastered count and practice-session count, which decide its gate. The mastery explainer SHALL show to
every player after the rings until dismissed, under its own dismissal flag.

#### Scenario: Signed in

- **WHEN** a user is signed in
- **THEN** the nudge does not render

Source: `app/journey/page.tsx:665`, `app/journey/page.tsx:803`, `app/journey/page.test.tsx:428`, `app/journey/page.test.tsx:437`.

### Requirement: Mastery rings, introduced ring and generation breakdown (baseline)

Percentages SHALL round to whole numbers and be 0 for a zero total. The locked percentage SHALL be the
remainder after mastered and learning, floored at 0. Ring
animation SHALL drop when reduced motion is requested. Each generation row SHALL link to
`/pokedex?gen=<gen>` and show mastered over total.

#### Scenario: Reduced motion

- **WHEN** `prefers-reduced-motion: reduce` matches
- **THEN** the ring has no stroke transition

#### Scenario: Generation row

- **WHEN** a player activates a generation row
- **THEN** the Pokédex opens filtered to that generation

Source: `app/journey/page.tsx:53`, `app/journey/page.tsx:73`, `app/journey/page.tsx:192`, `app/journey/page.tsx:212`, `app/journey/page.tsx:365`.

### Requirement: Language breakdown (baseline)

The section SHALL render only with the languages flag on and more than one learning locale. Each row
SHALL show the endonym, that locale's mastered count and its best review day, or a no-reviews message.
Best day SHALL reflect real history even under `pretendAllMastered`.

#### Scenario: One language

- **WHEN** `learningLocales` has one entry
- **THEN** the section renders nothing

#### Scenario: Superuser pretend-all-mastered

- **WHEN** `pretendAllMastered` is on with two locales
- **THEN** mastered counts are forced and best day stays real

Source: `components/journey/LanguageBreakdown.tsx:65`, `components/journey/LanguageBreakdown.tsx:102`, `components/journey/LanguageBreakdown.tsx:152`, `components/journey/LanguageBreakdown.test.tsx:151`, `components/journey/LanguageBreakdown.test.tsx:232`, `components/journey/LanguageBreakdown.test.tsx:250`.

### Requirement: Close to mastery list (baseline)

The list SHALL hold species in the active locale whose name card has cleared the mastery gate and
whose reverse card is the blocking leg, delegating to `computeSpeciesLegStatuses`. It SHALL sort by
reverse stability descending, then reps descending, then species id ascending, and show the first 10
with a "showing of" note. It SHALL be empty under `pretendAllMastered`, and show an empty state.

#### Scenario: A second language holds a higher reverse card

- **WHEN** the same species has reverse cards in two locales
- **THEN** only the active locale's card drives the bar, the sort and the days remaining

#### Scenario: Reverse card not started

- **WHEN** the reverse card has never been reviewed
- **THEN** the row shows the not-started label and no days-remaining badge

#### Scenario: More than ten

- **WHEN** 12 species qualify
- **THEN** 10 rows show, the note reads 10 of 12, and the count line says 12

Source: `lib/journey/closeToMastery.ts:77`, `lib/journey/closeToMastery.ts:84`, `lib/journey/closeToMastery.ts:107`, `lib/journey/closeToMastery.ts:127`, `components/journey/CloseToMastery.tsx:36`, `components/journey/CloseToMastery.tsx:79`, `components/journey/CloseToMastery.tsx:133`, `components/journey/CloseToMastery.tsx:192`, `lib/journey/closeToMastery.test.ts:138`, `lib/journey/closeToMastery.test.ts:204`, `lib/journey/closeToMastery.test.ts:293`.

### Requirement: Evolution wall (baseline)

The wall SHALL always show families completed over total, with the gallery collapsed by default but
kept in the DOM. Filters SHALL be All, In progress (any edge mastered in either direction, family not
complete) and Completed, each with its own empty message. An edge SHALL be green with both directions
mastered, amber with one, grey with none. A family with any branching node SHALL render as a tree,
otherwise as a single row. Names SHALL follow the active name locale, falling back to English.

#### Scenario: Collapsed

- **WHEN** the page loads
- **THEN** the summary line shows and the panel carries `hidden`, with `aria-controls` still valid

#### Scenario: In progress filter with nothing started

- **WHEN** no edge has any mastered direction
- **THEN** the in-progress empty message shows

Source: `app/journey/page.tsx:544`, `components/journey/EvolutionWall.tsx:39`, `components/journey/EvolutionWall.tsx:61`, `components/journey/EvolutionWall.tsx:158`, `components/journey/EvolutionWall.tsx:196`, `components/journey/EvolutionWall.tsx:398`, `components/journey/EvolutionWall.tsx:466`, `components/journey/EvolutionWall.tsx:475`.

### Requirement: Badge catalogue ships as code (baseline)

The catalogue SHALL hold 17 badges in code: 8 Kanto gym badges and 9 themed groups, each with a stable
id, English name, description and locked hint, an `all-mastered` species list, and artwork at
`/badges/<id>.png`. A badge with an empty list SHALL never be awarded. Badge text is English in every
locale (#2288).

#### Scenario: Empty criterion

- **WHEN** a badge's `speciesIds` is empty
- **THEN** `checkBadges` never returns it

#### Scenario: Japanese app language

- **WHEN** the app language is `ja`
- **THEN** badge names, descriptions and hints still show in English

Source: `lib/badges/catalog.ts:44`, `lib/badges/artwork.ts:26`, `lib/badges/check.ts:28`, `lib/badges/check.test.ts:81`, `lib/badges/catalog.test.ts`.

### Requirement: What counts towards a badge (baseline)

A species SHALL count when both its name card and its reverse card in the given locale are at or above
mastery stability. Cards with no locale SHALL read as `en`. `checkBadges` SHALL return, in catalogue
order, unearned badges whose whole list is mastered. An earned badge SHALL stay earned after a lapse, a
language switch or an undo of the grade that earned it, since award code only appends. Older comments
saying name-card mastery are stale.

#### Scenario: Name mastered, reverse not

- **WHEN** only the name card has cleared the gate
- **THEN** the species does not count

#### Scenario: Mastered in another language

- **WHEN** both legs are mastered in `ja` and the check runs for `en`
- **THEN** the species does not count

#### Scenario: A species lapses after the badge

- **WHEN** a species in an earned badge falls below the gate
- **THEN** the badge stays, because award code only appends

#### Scenario: The earning grade is undone

- **WHEN** a player undoes the grade that earned a badge
- **THEN** the badge and its `earnedAt` stay, because undo does not touch settings

Source: `components/review/ReviewSession.tsx:3068`, `lib/badges/derive.ts:33`, `lib/badges/derive.ts:43`, `lib/badges/check.ts:9`, `lib/badges/check.test.ts:39`, `lib/badges/check.test.ts:59`, `lib/badges/derive.test.ts:140`, `lib/badges/derive.test.ts:153`, `lib/badges/catalog.ts:12`.

### Requirement: Award on the grade that crosses mastery (baseline)

After a grade, the app SHALL run the award check in a macrotask only when the graded card crossed the
gate, is a name card, and no superuser flag is on. It SHALL use the graded card's locale, append new
badges with an `earnedAt` timestamp, save settings and queue a toast, and SHALL skip if the session has
unmounted. This looks wrong: when the reverse card is the leg that completes the species the check does
not run, so that badge has no toast and arrives later through the silent check (#2282).

#### Scenario: Name card completes the species

- **WHEN** a name-card grade crosses the gate and the reverse card is already mastered
- **THEN** any completed badge is saved and its toast shows

#### Scenario: Reverse card completes the species

- **WHEN** a reverse-card grade crosses the gate and the name card is already mastered
- **THEN** no check runs and no toast shows

#### Scenario: Superuser flag on

- **WHEN** any flag is on
- **THEN** no badge is awarded

Source: `components/review/ReviewSession.tsx:2666`, `components/review/ReviewSession.tsx:2670`, `components/review/ReviewSession.tsx:3033`, `components/review/ReviewSession.tsx:3042`, `components/review/ReviewSession.tsx:3044`, `components/review/ReviewSession.tsx:3062`.

### Requirement: Silent retroactive award (baseline)

Journey and Stats SHALL each run the same check on load against local cards in the active locale,
with no toast, and only with no superuser flag on. The check is idempotent, so running on both is safe.
Earned ids from before the check SHALL show if a flag is on.

#### Scenario: Fresh pull brings mastery in

- **WHEN** a load finds a met, unearned badge
- **THEN** it is saved with the current time and appears at once, with no toast

#### Scenario: Superuser flag on

- **WHEN** any flag is on
- **THEN** nothing is saved and the stored earned ids are shown

Source: `app/journey/page.tsx:471`, `app/journey/page.tsx:480`, `app/journey/page.tsx:488`, `app/journey/page.tsx:494`, `app/stats/page.tsx:315`, `app/stats/page.tsx:332`.

### Requirement: Earned badges persist in settings and do not regress (baseline)

Earned badges SHALL live in settings as id and `earnedAt` pairs, reach the cloud inside the settings
JSONB, and be replaced as a whole on write. The cloud trigger SHALL reject an update that removes a
badge id. A developer row in Settings, shown only in the superuser section, SHALL clear the local
list. The Journey page SHALL ignore a stored id that is not in the catalogue.

#### Scenario: A push would drop a badge

- **WHEN** an update's `earnedBadges` lacks an id the row holds
- **THEN** the trigger refuses the regression

#### Scenario: Unknown stored id

- **WHEN** settings hold an id with no catalogue entry
- **THEN** Journey leaves it out

Source: `lib/settings/persistence.ts:338`, `lib/settings/persistence.ts:858`, `lib/settings/lastPushedSnapshot.ts:99`, `db/migrations/038_user_settings_reject_regression_trigger.sql:11`, `db/migrations/038_user_settings_reject_regression_trigger.sql:102`, `app/settings/page.tsx:139`, `app/settings/page.tsx:2102`, `app/settings/page.tsx:2199`, `app/journey/page.tsx:589`.

### Requirement: Badge gallery (baseline)

The gallery SHALL list earned badges in catalogue order, or a no-badges message. Locked badges SHALL sit
behind a collapsed toggle with their count, kept in the DOM with `hidden`. An earned tile SHALL show
full-colour artwork and the name. A locked tile SHALL show greyscale artwork and the hint; its accessible
label SHALL still contain the badge name.

#### Scenario: Toggle

- **WHEN** a player presses "View all badges"
- **THEN** locked tiles show and `aria-expanded` becomes true

#### Scenario: Locked tile with a screen reader

- **WHEN** a screen reader reaches a locked tile
- **THEN** it reads the name, "(locked)" and the hint, and the image alt is generic

Source: `components/badges/BadgeGallery.tsx:83`, `components/badges/BadgeGallery.tsx:120`, `components/badges/BadgeGallery.tsx:136`, `components/badges/BadgeGallery.tsx:157`, `components/badges/BadgeGalleryCard.tsx:33`, `components/badges/BadgeGalleryCard.tsx:55`, `components/badges/BadgeGalleryCard.tsx:60`, `components/badges/BadgeGallery.test.tsx:147`, `components/badges/BadgeGallery.test.tsx:153`, `components/badges/BadgeGalleryCard.test.tsx:72`.

### Requirement: Next badge hint (baseline)

With mastered species known and `pretendAllMastered` off, the gallery SHALL name the unearned badge with
the fewest species left, ties going to catalogue order, and say how many remain. A badge with none left
SHALL be skipped as about to be awarded. The hint SHALL use the active name locale's mastery.

#### Scenario: Tie

- **WHEN** two unearned badges each need one more
- **THEN** the earlier in the catalogue is named

#### Scenario: Every unearned badge is met

- **WHEN** all unearned badges have none left
- **THEN** no hint renders

Source: `components/badges/BadgeGallery.tsx:38`, `components/badges/BadgeGallery.tsx:49`, `components/badges/BadgeGallery.tsx:95`, `app/journey/page.tsx:603`, `components/badges/BadgeGallery.test.tsx:32`, `components/badges/BadgeGallery.test.tsx:43`.

### Requirement: Badge toast (baseline)

A toast SHALL show one badge at a time from a queue, pinned bottom-centre with `role="status"`. It SHALL
dismiss after 4.5 seconds or on press, and a parent re-render SHALL NOT restart the timer.

#### Scenario: Two badges at once

- **WHEN** a grade earns two badges
- **THEN** the second toast shows after the first dismisses

#### Scenario: Grade during the toast

- **WHEN** the session re-renders with a new `onDismiss`
- **THEN** the timer keeps its original deadline

Source: `components/badges/BadgeToast.tsx:13`, `components/badges/BadgeToast.tsx:30`, `components/badges/BadgeToast.tsx:39`, `components/review/ReviewSession.tsx:925`, `components/review/ReviewSession.tsx:930`, `components/badges/BadgeToast.test.tsx:29`, `components/badges/BadgeToast.test.tsx:45`.

### Requirement: Superuser overlay on Journey (baseline)

With `pretendAllMastered` on, the trainer card and gallery SHALL show every badge as earned, with no
locked section and no hint, without changing stored badges. With any flag on, the milestone banner SHALL
not render, so fake mastery cannot produce a real share card.

#### Scenario: A flag other than pretend-all-mastered

- **WHEN** a flag is on but `pretendAllMastered` is off
- **THEN** real earned badges show and the milestone banner stays hidden

Source: `app/journey/page.tsx:587`, `app/journey/page.tsx:676`, `components/badges/BadgeGallery.tsx:83`, `components/badges/BadgeGallery.test.tsx:181`, `components/badges/BadgeGallery.test.tsx:188`.

### Requirement: Timeline past replay (baseline)

The past direction SHALL replay grade-log entries in the active locale through the scheduler with default
weights, oldest first, skipping entries with no subject key or an invalid grade. A species SHALL count as
introduced at its first name or reverse grade, and as mastered from its first moment with both legs at
the gate. A later lapse SHALL NOT revoke that count, so the Now snapshot can exceed live mastery. Legacy
entries with no locale SHALL read as `en`.

#### Scenario: Mastered then lapsed

- **WHEN** a species crossed the gate and later lapsed
- **THEN** every later snapshot still counts it as mastered

#### Scenario: Two languages share a subject key

- **WHEN** a species has grades in `en` and `ja`
- **THEN** only the active locale's entries are replayed

#### Scenario: Log begins with reverse entries

- **WHEN** a species' first entry is a reverse grade
- **THEN** it is introduced at that entry

Source: `lib/timeline/reconstruct.ts:96`, `lib/timeline/reconstruct.ts:155`, `lib/timeline/reconstruct.ts:184`, `lib/timeline/reconstruct.ts:219`, `lib/timeline/reconstruct.ts:240`, `lib/timeline/reconstruct.ts:250`, `lib/timeline/reconstruct.ts:537`, `lib/timeline/reconstruct.test.ts:71`, `lib/timeline/reconstruct.test.ts:336`, `lib/timeline/reconstruct.test.ts:586`.

### Requirement: Timeline past sampling (baseline)

Snapshots SHALL be daily at UTC midnight for the last 90 days, weekly from the Sunday at or before the
first grade for anything older, and the last entry SHALL be exactly now. An empty replay SHALL give no
past snapshots.

#### Scenario: Two-year-old history

- **WHEN** the first grade is two years old
- **THEN** older history is weekly, the last 90 days are daily, and the final snapshot is at `nowMs`

#### Scenario: Empty log

- **WHEN** the log is empty
- **THEN** `past` is empty

Source: `lib/timeline/reconstruct.ts:267`, `lib/timeline/reconstruct.ts:284`, `lib/timeline/reconstruct.ts:308`, `lib/timeline/reconstruct.ts:323`, `lib/timeline/reconstruct.ts:328`, `lib/timeline/reconstruct.test.ts:66`, `lib/timeline/reconstruct.test.ts:299`.

### Requirement: Timeline forgetting projection (baseline)

The future direction SHALL give one snapshot per day from day 0 to day 180, 181 in all, from the active
locale's reviewed name cards, measured from each card's last review with the FSRS power-law curve and the player's retention
target (default 0.9). A card already below target SHALL count as forgotten at day 0. A snapshot's `mastered` and `introduced` here both mean
retained, across every reviewed card, not mastered cards only. No reviewed card SHALL give no future.

#### Scenario: Overdue card

- **WHEN** a card's projected forget time is before now
- **THEN** it is subtracted from day 0 onwards

#### Scenario: Card lasting past the horizon

- **WHEN** a card's forget time is beyond 180 days
- **THEN** it stays retained in every snapshot

#### Scenario: Never reviewed

- **WHEN** a card's `lastReview` is null
- **THEN** it is left out of the tracked count

Source: `lib/timeline/reconstruct.ts:365`, `lib/timeline/reconstruct.ts:395`, `lib/timeline/reconstruct.ts:408`, `lib/timeline/reconstruct.ts:421`, `lib/timeline/reconstruct.ts:431`, `lib/timeline/reconstruct.ts:439`, `lib/timeline/reconstruct.ts:447`, `app/journey/page.tsx:524`, `lib/timeline/reconstruct.test.ts:375`, `lib/timeline/reconstruct.test.ts:392`, `lib/timeline/reconstruct.test.ts:426`.

### Requirement: Timeline under pretend-all-mastered (baseline)

With `pretendAllMastered` on, every name-card species SHALL be synthesised as introduced and mastered 90
days and 1 ms before now, and each card SHALL project with a stability of 9,999 days. Both directions
read flat at full, except the first past snapshot: it is the UTC midnight of that day, before the
synthetic time unless now is exactly midnight, so it reads 0. This looks wrong (#2341).

#### Scenario: Flag on with an empty log

- **WHEN** the flag is on and there are no grades
- **THEN** every past snapshot after the first shows every species mastered

#### Scenario: Far left of the slider

- **WHEN** the flag is on, it is not exactly UTC midnight, and the slider is at 0
- **THEN** the counts read 0 (#2341)

Source: `lib/timeline/reconstruct.ts:303`, `lib/timeline/reconstruct.ts:401`, `lib/timeline/reconstruct.ts:541`, `lib/timeline/reconstruct.ts:549`, `lib/timeline/reconstruct.test.ts:471`.

### Requirement: Timeline scrubber (baseline)

The widget SHALL start at now, on a 0 to 400 range input where 200 is now and position is
`(value - 200) / 200`. `snapshotAtPosition` SHALL treat any position above 0 as future, while the widget
labels future only above 0.01 and past only below -0.01. This looks wrong (#2284). The same band applies
left of now: 198 and 199 read Now while showing a past snapshot. Percentages SHALL use the default-form
`totalSpecies`. A live region SHALL announce the date and counts.

#### Scenario: Keyboard, one step right of now

- **WHEN** the slider moves from 200 to 201
- **THEN** the pill reads Now, the date is tomorrow, and both counts show the projected retained figure

#### Scenario: Three steps right of now

- **WHEN** the slider reaches 203
- **THEN** the pill reads Future and the widget shows retained and forgotten

#### Scenario: Offline guest with no history

- **WHEN** both `past` and `future` are empty
- **THEN** the no-history state shows and there is no slider

#### Scenario: Back to now

- **WHEN** the player double-clicks the slider or presses Reset
- **THEN** the slider returns to 200

#### Scenario: Forgotten count with overdue cards

- **WHEN** the slider is in the future range and some cards were overdue at day 0
- **THEN** Forgotten is `future[0].mastered` minus the retained count, which leaves those cards out (#2287)

Source: `components/journey/CollectionTimeline.tsx:54`, `components/journey/CollectionTimeline.tsx:59`, `components/journey/CollectionTimeline.tsx:137`, `components/journey/CollectionTimeline.tsx:138`, `components/journey/CollectionTimeline.tsx:162`, `components/journey/CollectionTimeline.tsx:167`, `components/journey/CollectionTimeline.tsx:186`, `components/journey/CollectionTimeline.tsx:235`, `components/journey/CollectionTimeline.tsx:386`, `lib/timeline/reconstruct.ts:584`, `app/journey/page.tsx:536`, `components/journey/CollectionTimeline.test.tsx:61`, `components/journey/CollectionTimeline.test.tsx:77`.

### Requirement: Per-species mastery date (baseline)

`buildSpeciesMasteryDates` SHALL map species ids to the UTC date of their most recent crossing, from the
same replay, for the Pokédex detail page. The hook SHALL share one result per locale and flag, drop it on
`GRADE_LOG_CHANGED_EVENT` or a `storage` event for the grade-log key, and return null while loading, with
no recoverable crossing, or under `pretendAllMastered`.

#### Scenario: Re-mastered after a lapse

- **WHEN** a species lapsed and crossed again
- **THEN** the later date is returned

#### Scenario: Crossing not in the log

- **WHEN** the crossing's entries are not in the log
- **THEN** the hook returns null, never a guessed date. `pruneGradeLog` has no production caller, so the 365-day guest pruning in the comments does not happen on `qa`

Source: `lib/timeline/reconstruct.ts:649`, `lib/timeline/reconstruct.ts:655`, `lib/timeline/useSpeciesMasteryDate.ts:26`, `lib/timeline/useSpeciesMasteryDate.ts:67`, `lib/timeline/useSpeciesMasteryDate.ts:94`, `lib/gradelog/persistence.ts:344`, `components/pokedex/PokemonDetailDisclosure.tsx:354`, `lib/timeline/reconstruct.test.ts:670`, `lib/timeline/reconstruct.test.ts:707`, `components/timeline/useSpeciesMasteryDate.test.tsx:107`, `components/timeline/useSpeciesMasteryDate.test.tsx:155`.

### Requirement: Milestone detection (baseline)

`detectTopMilestone` SHALL return one milestone or null, in this order: all mastered at 1025 or more; the
highest-numbered complete generation, which is not necessarily the most recent; then the highest crossed
count from 10, 25, 50, 100, 151, 200, 250, 300, 400 to 1000 in hundreds. A count milestone SHALL carry
the threshold, not the live total.

#### Scenario: Generation beats count

- **WHEN** Gen I is complete and 500 species are mastered
- **THEN** the Gen I milestone is returned, not 500

#### Scenario: Below the first threshold

- **WHEN** 9 species are mastered
- **THEN** the result is null and no banner shows

Source: `lib/journey/milestones.ts:13`, `lib/journey/milestones.ts:95`, `lib/journey/milestones.ts:103`, `lib/journey/milestones.ts:116`, `lib/journey/milestones.test.ts:43`, `lib/journey/milestones.test.ts:124`, `lib/journey/milestones.test.ts:172`.

### Requirement: Milestone banner and share copy (baseline)

The banner SHALL take its label, share text and image hero text from `journey.milestoneShare.*`, passing
both the decimal and Roman generation so each locale can choose. All-mastered and generation cards SHALL
use a star; count cards SHALL use the threshold. A null milestone SHALL render nothing.

#### Scenario: Japanese

- **WHEN** the app language is `ja` and a generation is complete
- **THEN** the banner and share text use the Japanese messages

Source: `components/journey/MilestoneShareButton.tsx:47`, `components/journey/MilestoneShareButton.tsx:61`, `components/journey/MilestoneShareButton.tsx:116`, `components/journey/MilestoneShareButton.test.tsx:73`, `components/journey/MilestoneShareButton.test.tsx:341`, `components/journey/MilestoneShareButton.locale.test.tsx`.

### Requirement: Share fallback order (baseline)

Both share buttons SHALL try, in order: Web Share with the PNG when `canShare` accepts files; Web Share
with text when file sharing is unavailable; a `poke-memory.png` download when an image exists; clipboard
text. Dismissing the file sheet SHALL stop quietly. Another file-share error SHALL skip the text sheet
and continue to download. Any rejection of the text sheet, dismissal included, SHALL continue to
download or clipboard. This looks wrong (#2340). A copy result SHALL show for 2 seconds.

#### Scenario: Player dismisses the file sheet

- **WHEN** the file `share` rejects with `AbortError`
- **THEN** nothing else happens

#### Scenario: Player dismisses the text sheet

- **WHEN** file sharing is unavailable and the text `share` rejects with `AbortError`
- **THEN** the PNG downloads, or with no image the text is copied (#2340)

#### Scenario: Offline desktop browser with no Web Share

- **WHEN** the image renders and `navigator.share` is absent
- **THEN** the PNG downloads

#### Scenario: Nothing works

- **WHEN** no image, no Web Share and no clipboard exist
- **THEN** an error message shows for 2 seconds

Source: `components/review/ShareTodayButton.tsx:46`, `components/review/ShareTodayButton.tsx:63`, `components/review/ShareTodayButton.tsx:75`, `components/review/ShareTodayButton.tsx:83`, `components/review/ShareTodayButton.tsx:90`, `components/review/ShareTodayButton.tsx:105`, `components/journey/MilestoneShareButton.tsx:152`, `components/journey/MilestoneShareButton.tsx:181`, `components/journey/MilestoneShareButton.tsx:189`, `components/journey/MilestoneShareButton.tsx:196`, `components/journey/MilestoneShareButton.tsx:211`, `components/review/ShareTodayButton.test.tsx:196`, `components/journey/MilestoneShareButton.test.tsx:226`, `components/journey/MilestoneShareButton.test.tsx:291`.

### Requirement: Daily summary text (baseline)

`useShareSheet` SHALL return null for both values with no grades, and otherwise the date in the player's
timezone, the counts and the grade sequence. The text SHALL have a `poke-memory · <date>` line, a streak
line when above 0, a counts line, and one coloured square per grade wrapped every 20, with no Pokémon
names. The streak is computed against the UTC date, though
streak dates are stored by local date (#2283). No production caller passes a locale (#2286).

#### Scenario: No grades

- **WHEN** the grade sequence is empty
- **THEN** there is no share button

#### Scenario: Forty-one grades

- **WHEN** 41 grades were made
- **THEN** the grid has three rows

#### Scenario: Local date ahead of UTC

- **WHEN** a player's only streak date is local today and UTC is still yesterday
- **THEN** the shared streak is 0 and the streak line is left out

#### Scenario: Japanese session

- **WHEN** the session language is `ja`
- **THEN** the mastered line has no language suffix and the text is English (#2288)

Source: `components/review/useShareSheet.ts:32`, `components/review/useShareSheet.ts:43`, `components/review/useShareSheet.ts:46`, `components/review/ReviewSession.tsx:1249`, `components/review/ReviewSession.tsx:2640`, `components/review/ReviewSession.tsx:2972`, `lib/review/share.ts:53`, `lib/review/share.ts:56`, `lib/review/share.ts:61`, `lib/review/share.ts:71`, `lib/review/share.test.ts:21`, `lib/review/share.test.ts:33`, `lib/review/share.test.ts:66`, `components/review/useShareSheet.test.tsx:31`.

### Requirement: Daily share availability (baseline)

The button SHALL show at the end of a session when share text exists, including with a superuser flag on.
The summary SHALL be saved locally after each grade with no flag on, so it survives a reload. On load, a
stored summary SHALL be restored whatever the flags. With none stored and no flag on, the grade sequence
SHALL be rebuilt from today's grade log, leaving new and mastered at 0. Mastered in the summary SHALL
count species crossings, from either leg.

#### Scenario: Reload after the session

- **WHEN** a player reloads on the same day
- **THEN** the summary is restored and the button returns

#### Scenario: Summary missing, grades logged

- **WHEN** no summary is stored and today's grade log has entries
- **THEN** the button returns with the grid and reviewed total, and new and mastered read 0

#### Scenario: Superuser flag on

- **WHEN** a flag is on
- **THEN** the grades are not saved to the daily summary and the grade log is not used to rebuild it

Source: `components/review/ReviewSession.tsx:699`, `components/review/ReviewSession.tsx:1452`, `components/review/ReviewSession.tsx:1457`, `components/review/ReviewSession.tsx:2308`, `components/review/ReviewSession.tsx:3009`, `components/review/ReviewSession.tsx:3014`.

### Requirement: Share image (baseline)

The image SHALL be a 600 by 720 card exported at 2x, using theme colours with hex-validated fallbacks. It
SHALL show the wordmark, date, a hero disc and, on the daily card only, a reviewed, new and mastered row.
The ring SHALL use the accent at a 3:1 contrast or better, otherwise white. The result SHALL be null
without a document or canvas. The daily date comes from the summary, the milestone date from the device.

#### Scenario: Streak 0

- **WHEN** the streak is 0
- **THEN** the hero shows the reviewed count with "CARDS TODAY"

#### Scenario: Long milestone label

- **WHEN** the label is over 20 characters
- **THEN** the disc shows `MILESTONE`

#### Scenario: Canvas unavailable

- **WHEN** `getContext` returns null
- **THEN** the buttons continue with text sharing

Source: `lib/share/generateShareImage.ts:49`, `lib/share/generateShareImage.ts:59`, `lib/share/generateShareImage.ts:146`, `lib/share/generateShareImage.ts:207`, `lib/share/generateShareImage.ts:551`, `lib/share/generateShareImage.ts:616`, `lib/share/generateShareImage.ts:623`, `lib/share/generateShareImage.ts:677`, `lib/share/generateShareImage.ts:686`, `components/share/generateShareImage.test.tsx`.

### Requirement: Favourite on the share image (baseline)

The only Pokémon on a share image SHALL be the player's favourite, named in the active name locale and
shown as a silhouette until mastered at species level in any enrolled locale, or under
`pretendAllMastered`. With no favourite none SHALL be painted. A sprite that fails or takes over 3
seconds SHALL leave the name alone.

#### Scenario: Unmastered favourite

- **WHEN** the favourite is not mastered
- **THEN** its sprite is filled with one colour and its name shows

#### Scenario: Offline, sprite missing

- **WHEN** the sprite errors
- **THEN** the card still renders with the name

Source: `components/favourite/useSharePartner.ts:16`, `components/favourite/usePartner.ts:26`, `lib/share/generateShareImage.ts:4`, `lib/share/generateShareImage.ts:443`, `lib/share/generateShareImage.ts:462`, `lib/share/generateShareImage.ts:487`.

### Requirement: Status bar placement and contents (baseline)

The bar SHALL render below the nav on every route, except hidden below `md` on `/` only. It SHALL be a
named region, not a live region, and hold a same-height skeleton until every value exists. Single-language
players SHALL see streak, mastery, token. With languages on, players SHALL see streak, token, a divider,
mastery and the language switcher. The chips SHALL make no cloud writes; the switcher saves settings.

#### Scenario: Mobile Practice

- **WHEN** the route is exactly `/` below `md`
- **THEN** the bar is hidden

#### Scenario: Languages on

- **WHEN** `languagesEnabled` is true
- **THEN** the divider and switcher show

#### Scenario: Switching language, signed in

- **WHEN** a signed-in player picks another language in the bar
- **THEN** a settings patch carrying `pokemonNameLocale` is pushed; `activePokemonNameLocale` stays on the device

Source: `components/i18n/LanguageSwitcher.tsx:182`, `lib/settings/persistence.ts:1170`, `lib/settings/lastPushedSnapshot.ts:41`, `components/sync/AutoSyncOnChange.tsx:64`, `app/layout.tsx:191`, `components/profile/ProfileStatusBar.tsx:58`, `components/profile/ProfileStatusBar.tsx:63`, `components/profile/ProfileStatusBar.tsx:84`, `components/profile/ProfileStatusBar.tsx:101`, `components/profile/ProfileStatusBar.test.tsx:122`, `components/profile/ProfileStatusBar.test.tsx:262`, `components/profile/ProfileStatusBar.test.tsx:285`.

### Requirement: Status chips (baseline)

Each chip SHALL be a button whose accessible label is also its popover text. The popover SHALL open on
tap, hover on hover-capable devices, and focus, and close on outside press, Escape or blur. The streak
chip at 0 SHALL prompt to start. The token chip SHALL render nothing below 1. The mastery chip SHALL always
render, with an encouraging label at 0. `StreakBadge` SHALL reuse the same chips.

#### Scenario: No tokens

- **WHEN** the token balance is 0
- **THEN** no token chip renders

#### Scenario: Escape

- **WHEN** a popover is open and Escape is pressed
- **THEN** it closes

Source: `components/profile/StatusChips.tsx:122`, `components/profile/StatusChips.tsx:133`, `components/profile/StatusChips.tsx:179`, `components/profile/StatusChips.tsx:290`, `components/profile/StatusChips.tsx:320`, `components/profile/StatusChips.tsx:349`, `components/review/StreakBadge.tsx:195`, `components/profile/StatusChips.test.tsx`.

### Requirement: Status bar mastery figures (baseline)

`useProfileStatus` SHALL return null until after the first client render, then read the mastered count
from the local cache for the active locale, and take the total from `seed.seedPokemon.length`, rounding
the percentage to one decimal. This looks wrong: that length holds 1174 entries against 1025 species, so
it disagrees with Journey (#2285). It SHALL refresh on the cache's `storage` event and on settings save.

#### Scenario: Every species mastered

- **WHEN** all 1025 species are mastered
- **THEN** the chip shows 87.3% of 1174

#### Scenario: Superuser pretend-all-mastered

- **WHEN** the flag is on
- **THEN** the chip shows 100% and the cache is untouched

#### Scenario: Switching language

- **WHEN** the active locale changes
- **THEN** the count re-reads that locale's cached value

Source: `lib/profile/useProfileStatus.ts:82`, `lib/profile/useProfileStatus.ts:100`, `lib/profile/useProfileStatus.ts:101`, `lib/profile/useProfileStatus.ts:115`, `lib/profile/useProfileStatus.ts:118`, `lib/profile/useProfileStatus.ts:134`, `public/pokemon-data/generated-core.json`, `components/profile/useProfileStatus.test.tsx:44`, `components/profile/useProfileStatus.test.tsx:381`.

### Requirement: Mastered and due count caches (baseline)

Both caches SHALL be local only, per locale, and read as zeros when absent or malformed. With no
superuser flag on, `ReviewSession` SHALL write both on mount, due counts after every grade and the
mastered count after name and reverse grades, but not on undo (#2343). Each write SHALL fire a synthetic
`storage` event. The mastered count SHALL cover the active locale only, derived as in `computeStats`. Due
counts SHALL cover every locale, reviews only, not cards reviewed today.

#### Scenario: Progress reset

- **WHEN** a player resets progress
- **THEN** both caches are cleared

#### Scenario: Malformed cache

- **WHEN** the stored value is not an object
- **THEN** every locale reads 0

#### Scenario: Two devices

- **WHEN** another device mastered species and this one pulled them, on Journey
- **THEN** Journey shows the new count and the status bar keeps the old one until Practice mounts

#### Scenario: Grade in one language

- **WHEN** a player grades in `ja`
- **THEN** other locales' mastered counts are preserved

#### Scenario: Language not yet opened here

- **WHEN** the active locale has had no Practice mount on this device
- **THEN** its mastered count reads 0

#### Scenario: Account switch

- **WHEN** the account changes on a shared device
- **THEN** the archive holds these caches per user

#### Scenario: Undo of a mastering grade

- **WHEN** a player undoes the grade that crossed mastery
- **THEN** the status bar keeps the higher count until the next name or reverse grade or Practice mount (#2343)

Source: `components/review/ReviewSession.tsx:3068`, `lib/profile/masteredCountCache.ts:43`, `lib/profile/masteredCountCache.ts:72`, `lib/profile/dueCountCache.ts:46`, `lib/profile/dueCountCache.ts:72`, `lib/profile/dueCountCache.ts:109`, `components/review/ReviewSession.tsx:313`, `components/review/ReviewSession.tsx:328`, `components/review/ReviewSession.tsx:1494`, `components/review/ReviewSession.tsx:2860`, `components/review/ReviewSession.tsx:2869`, `lib/storage/reset.ts:25`, `lib/storage/userArchive.ts:44`, `components/profile/masteredCountCache.test.tsx`, `components/profile/dueCountCache.test.tsx`.

### Requirement: Hard-coded English on these surfaces (baseline)

Journey sections, the milestone banner and chips SHALL use the message catalogue. The Share today button,
daily share text and image, badge catalogue text, the toast's "Badge earned", badge tile labels, and
several accessible labels on the timeline, rings, generation meters and evolution arrows SHALL be
hard-coded English, as they are today (#2288).

#### Scenario: Non-English app language

- **WHEN** the app language is `zh-Hans` and a session ends
- **THEN** the Share today button reads in English

Source: `components/review/ShareTodayButton.tsx:127`, `components/badges/BadgeToast.tsx:56`, `components/badges/BadgeGalleryCard.tsx:36`, `components/journey/EvolutionWall.tsx:47`, `components/journey/CollectionTimeline.tsx:264`, `app/journey/page.tsx:311`, `app/journey/page.tsx:375`, `lib/share/generateShareImage.ts:412`.
