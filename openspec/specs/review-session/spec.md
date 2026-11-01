# review-session Specification

## Purpose
How the Practice page runs a review session: loading and saving the card set, which cards are in play,
which card is on screen, how a grade is applied and undone, what the end of a session shows, and how
the session stays in step with settings, languages and other tabs. This is the baseline: current
behaviour on `qa` at d2456f44, written from code and tests. It says what is true today, not what should
be. Where the behaviour looks wrong, the requirement says so and names the issue; those lines are what a
later change would MODIFY.

The open deltas `practice-scope`, `new-card-order` and `review-queue`, and the baselines
`local-data-and-backup`, `cloud-sync` and `srs-scheduling`, keep what they own (see "Reconciling the open
deltas" below). This spec says how the session uses them and does not repeat their rules.

Each requirement ends with a `source` comment. `RS` means `components/review/ReviewSession.tsx`.

## Requirements

### Requirement: The Practice route frames one review session (baseline)

The home route SHALL render a screen-reader-only heading, the first-visit onboarding modal, the streak
badge and one `ReviewSession`. At the `lg` breakpoint it SHALL add a right-hand `PracticeSidebar`,
hidden below it, which shows today's grades from the grade log in the player's time zone and refreshes
when a grade is appended or the log changes in another tab. A sign-in failure banner SHALL show only
when the `error` query value is `auth`.

#### Scenario: Failed sign-in return
- **WHEN** the page opens with `?error=auth`
- **THEN** an alert with the localised sign-in failure message shows above the session

#### Scenario: Phone width
- **WHEN** the viewport is below `lg`
- **THEN** the sidebar is hidden and the session fills the height between the navigation bars

<!-- source: app/page.tsx:16-32; app/page.tsx:83-121; components/practice/PracticeH1.tsx:21-24; components/review/PracticeSidebar.tsx:1-11; components/review/PracticeSidebar.test.tsx:93 -->

### Requirement: Nothing builds until the seed has loaded (baseline)

The session load SHALL wait for the seed. While the seed or the session is loading the page SHALL show
a busy skeleton. If the seed fetch fails it SHALL show a localised error with a retry button instead.

#### Scenario: Seed fetch fails offline
- **WHEN** the seed cannot be fetched
- **THEN** an alert with a retry button shows, and no session is built or saved

<!-- source: RS:1261-1263; RS:1792-1828 -->

### Requirement: A session is built once, or hydrated from the saved one (baseline)

With no saved session the load SHALL build one and save it. With a saved session it SHALL hydrate it, saving again
only when the card count changed or a card was healed. Limits SHALL come from settings, never the saved session.
Every saved card SHALL be kept whatever its type's setting, seed fields SHALL be refreshed while FSRS state and
locale are kept, and only enabled directions SHALL gain missing cards, in the active locale only.

#### Scenario: Seed adds a species
- **WHEN** a saved session lacks a species now in the seed
- **THEN** its enabled-direction cards are appended as new and the session is saved

#### Scenario: Guest with a new language
- **WHEN** a guest with `en` cards makes `ja` active
- **THEN** `ja` cards are added beside the `en` ones, because the duplicate check is on id and locale

#### Scenario: Type turned off
- **WHEN** cry cards are off and saved cry cards exist
- **THEN** they stay in storage and no new cry cards are added

<!-- source: RS:1278-1325; lib/review/session.ts:257-344; lib/review/session.ts:411-494; lib/review/session.test.ts:99; lib/review/session.test.ts:108; lib/review/session.test.ts:116; lib/review/session.test.ts:127 -->

### Requirement: An impossible FSRS state is healed on load (baseline)

A saved card that is not brand new and has a state FSRS would reject SHALL be reset to a new-card
state, due today (UTC), keeping `firstSeen`, `hiddenSince` and `seenInPasture`. Brand-new cards SHALL
never be healed. The heal SHALL be saved once and SHALL NOT fire again on the next load.

#### Scenario: Poison card, signed in
- **WHEN** a card with stability 0 in the review state loads
- **THEN** it becomes a new-state card due today, and a later cloud push of it may be refused by the regression trigger, which the code accepts

#### Scenario: Second load
- **WHEN** the healed card loads again
- **THEN** `anyHealed` is false and nothing is saved for it

<!-- source: lib/review/session.ts:346-409; lib/review/session.test.ts:154; lib/review/session.test.ts:182; lib/review/session.test.ts:203 -->

### Requirement: The full set is saved, the active language is shown (baseline)

The session SHALL keep the whole multi-locale array in a ref and hold only the active locale's cards
in React state. Every queue, lookup and render SHALL use the active-locale view, and every save SHALL
write the whole array. The active locale and enrolled languages SHALL be read once at load.

#### Scenario: Same id in two languages
- **WHEN** the active locale is `ja` and id 1 exists in `en` and `ja`
- **THEN** the `ja` card renders, and the save still contains both

#### Scenario: Grading in Japanese
- **WHEN** a `ja` card is graded
- **THEN** the full array changes only the row with that id and locale `ja`

<!-- source: RS:795-809; RS:1402-1408; RS:2618-2632; components/review/ReviewSession.test.tsx:5334; components/review/ReviewSession.test.tsx:5358 -->

### Requirement: The session reloads when its inputs change elsewhere (baseline)

Settings, card-type toggles, caps and locale SHALL be read at load only. The page SHALL do a full
reload when settings change in another tab, when the active locale changes in this tab, and when a
cloud pull applies progress. Other same-tab settings saves SHALL NOT reload it.

#### Scenario: Two tabs
- **WHEN** settings are saved in another tab
- **THEN** this tab reloads, even if a card is revealed

#### Scenario: Same-tab save of an unrelated setting
- **WHEN** `onboarding` flags are saved during practice
- **THEN** no reload happens, so the card on screen stays

#### Scenario: Pull from a second device
- **WHEN** `SYNC_PULL_APPLIED_EVENT` fires
- **THEN** the page reloads and rebuilds from the merged cards

<!-- source: components/review/useSessionReloadListeners.ts:23-57; components/review/useSessionReloadListeners.test.tsx:54; components/review/useSessionReloadListeners.test.tsx:76; components/review/useSessionReloadListeners.test.tsx:86; components/review/useSessionReloadListeners.test.tsx:97; RS:1278-1287 -->

### Requirement: Background work stands off while a session is mounted (baseline)

A mounted session SHALL add one to a `localStorage` reference count and remove it on unmount, clamped
at 0. While the count is above 0 the visibility pull and the silent service-worker activation SHALL
skip. A revealed card SHALL set a flag that makes the language switcher refuse a switch; the flag SHALL
clear on grade and on unmount, and undo SHALL set it again.

#### Scenario: Two tabs, one closes
- **WHEN** two Practice tabs are open and one closes
- **THEN** the count is 1 and background pulls stay off

#### Scenario: Corrupt count
- **WHEN** the stored count cannot be parsed
- **THEN** it reads as 0, which allows background work

<!-- source: lib/review/sessionActive.ts:43-55; lib/review/sessionActive.ts:77-100; lib/review/sessionActive.ts:121-140; RS:1518-1526; RS:2484-2486; RS:2908-2909; lib/sync/useVisibilityPull.ts:59; components/pwa/ServiceWorkerProvider.tsx:154; lib/review/sessionActive.test.ts:53; lib/review/sessionActive.test.ts:131 -->

### Requirement: Saved sessions live in IndexedDB with a localStorage fallback (baseline)

Which store is read and written is owned by `local-data-and-backup`. A `localStorage` write failure SHALL return
`quota` or `unknown` rather than throw, and a save on the server SHALL do nothing. Any failed result SHALL show the
dismissible storage banner, including `unknown`, and the next successful save SHALL clear it.

#### Scenario: Private browsing with no IndexedDB
- **WHEN** IndexedDB is unavailable
- **THEN** load and save use `localStorage` without touching IndexedDB

#### Scenario: Silent IndexedDB failure
- **WHEN** `idbSet` swallows an error and turns IndexedDB off
- **THEN** the save writes `localStorage` and returns `{ ok: true }`

#### Scenario: Storage full
- **WHEN** the `localStorage` write raises a quota error
- **THEN** `{ ok: false, reason: "quota" }` returns and the banner shows

<!-- source: lib/review/persistence.ts:292-324; lib/review/persistence.ts:338-358; lib/review/persistence.ts:436-465; lib/review/useStorageQuota.ts:12-28; lib/review/persistence.test.ts:243; lib/review/persistence.test.ts:318; lib/review/persistence.test.ts:376; lib/review/persistence.test.ts:421; lib/review/persistence.test.ts:498 -->

### Requirement: Saved data is checked whole and migrated on read (baseline)

The parser SHALL accept a bare card array (default limits) or `{cards, limits}`. It SHALL return null for the
whole session when any card has the wrong shape or an unknown type, for invalid JSON, or for bad limits. The load
then treats that as no session and saves a fresh deck over it, which looks like a bug (#2280). Legacy
per-pre-evolution cards SHALL be dropped, and missing fields SHALL be backfilled, with FSRS fields derived from old
SM-2 fields.

#### Scenario: One bad card
- **WHEN** one saved card lacks a `spriteUrl`
- **THEN** `loadSession` returns null and the load effect saves a fresh session over the saved one (#2280)

#### Scenario: SM-2 card from an old version
- **WHEN** a card has `repetitions`, `interval` and `easeFactor` but no `stability`
- **THEN** it gets FSRS fields in the review state and the old fields are removed

<!-- source: lib/review/persistence.ts:32-62; lib/review/persistence.ts:86-117; lib/review/persistence.ts:128-184; lib/review/persistence.ts:194-235; lib/review/persistence.ts:237-290; lib/review/card-shape.ts:109-119; RS:1289-1325; lib/review/session.test.ts:288; lib/review/session.test.ts:322; lib/review/session.test.ts:366 -->

### Requirement: Saves strip seed text and announce themselves (baseline)

A save SHALL drop `flavorTexts` and `evolutionChain` from name and reverse cards only; cry and evolution
cards keep whatever they hold. After a successful write it SHALL raise the write epoch and dispatch a
synthetic `storage` event and `SESSION_CHANGED_EVENT`.

#### Scenario: Same-tab subscribers
- **WHEN** a grade is saved
- **THEN** same-tab listeners hear a `storage` event for the session key and the custom event

<!-- source: lib/review/persistence.ts:326-336; lib/review/persistence.ts:360-434; lib/review/persistence.test.ts:175; lib/review/persistence.test.ts:188; lib/review/persistence.test.ts:550 -->

### Requirement: Eligibility has one shared card gate (baseline)

`isCardEligible` SHALL be the only card-type and alternate-form gate, for the client and the daily push. Name and
reverse SHALL always pass, evolution, reverse-evolution and cry SHALL follow their settings, and an unknown type
SHALL pass. With alternate forms off, a species card SHALL fail at id 10000 or above and an edge card SHALL fail when
either end is, while a malformed key SHALL pass. `computeEligibleCardIds` SHALL then apply the scope.

#### Scenario: Unknown future card type
- **WHEN** a card has a type this version does not know
- **THEN** the gate passes it

#### Scenario: Evolution into an alternate form
- **WHEN** alternate forms are off and an edge ends in an id of 10000 or above
- **THEN** the card is not eligible, although a doc comment says edges are never treated as forms (#2188)

<!-- source: lib/eligibility/index.ts:107-163; lib/review/scope.ts:414-432; lib/review/scope.ts:348-349; lib/eligibility/index.test.ts:41; lib/eligibility/index.test.ts:83; lib/eligibility/index.test.ts:136 -->

### Requirement: Eligible set is fixed between scope changes (baseline)

The session SHALL compute `eligibleCardIds` at load and on each scope change, and SHALL NOT recompute it after a
grade. Progress preset sets are recomputed by memo when the active-locale cards change and feed the Scope panel's
live count, so that count can move while the eligible set does not. At load the `incomplete-chains` set SHALL span
every locale, where later it spans the active one (looks like a bug, #2249). Hearted species SHALL be read at load.

#### Scenario: Species leaves Almost mastered mid-session
- **WHEN** a grade masters the last leg of a species under an "Almost mastered" scope
- **THEN** the panel count drops but its cards stay eligible until a reload or scope change

#### Scenario: Family mastered in English, in progress in Japanese
- **WHEN** a player reloads with `ja` active and an Incomplete chains scope
- **THEN** the load-time eligible set leaves that family out while the panel count includes it (#2249)

#### Scenario: Hearted on the Pokedex in the same session
- **WHEN** a species is hearted after Practice has loaded in another tab
- **THEN** the settings change reloads this tab, which is how the new heart is seen

<!-- source: RS:912-916; RS:1170-1191; RS:1362-1391; RS:1419; RS:1425; RS:995-1006; components/review/ScopeControl.tsx:164-180; lib/evolution/chains.ts:113-125 -->

### Requirement: A scope change applies at once (baseline)

A scope change SHALL update state, save settings with both scope onboarding flags set, reconcile snooze
on the active-locale cards only (other languages wait for their next load), recompute eligibility, clear
the display lock and save the full session. A scope change before cards load SHALL only save settings.

#### Scenario: Scope changed with a second language enrolled
- **WHEN** a player with `en` and `ja` cards changes scope with `en` active
- **THEN** only `en` cards are stamped now, and the `ja` cards are reconciled when next loaded

#### Scenario: Scope that matches nothing
- **WHEN** the new scope is non-empty and the eligible set is empty
- **THEN** the no-match screen replaces the session, as `practice-scope` describes, with a working Clear scope

<!-- source: RS:960-1019; RS:1888-1904; components/review/ReviewSession.test.tsx:1364; components/review/ReviewSession.test.tsx:1505 -->

### Requirement: Only scope pauses a card (baseline)

Snooze SHALL follow the practice scope alone. A card excluded by a card-type setting or the
alternate-forms toggle SHALL NOT get `hiddenSince`, so its `dueDate` keeps ageing and it returns overdue
when the setting changes back. On load, snooze SHALL run over every locale's cards with one scope.

#### Scenario: Alternate forms off for a month
- **WHEN** a due alternate-form card is excluded by the toggle for 30 days and the toggle is turned on
- **THEN** it returns with its original due date, unshifted

<!-- source: lib/review/filters.ts:66-99; RS:1380; lib/review/filters.test.ts:86; lib/review/filters.test.ts:101 -->

### Requirement: Badges and Stats match scope without progress context (baseline)

`computeQueueCount` and the Stats snapshot SHALL gate cards with no scope context, so `favourites`,
`incomplete-chains` and `mastery-blockers` match nothing on those surfaces. They SHALL pass no shuffle
salt and no priority list, which changes which cards are picked but not the counts. This differs from
Practice and looks like a bug (#2253).

#### Scenario: Favourites-only scope with two hearts
- **WHEN** the scope is Favourites with two hearted species that have new cards
- **THEN** Practice has 4 eligible cards and the app badge total is 0

#### Scenario: Scope with a static axis as well
- **WHEN** the scope is Favourites plus Gen I
- **THEN** the badge counts Gen I cards only

<!-- source: lib/stats/dashboard-snapshot.ts:165-187; lib/stats/dashboard-snapshot.ts:209-218; lib/stats/dashboard-snapshot.ts:298-299; components/pwa/usePwaBadge.ts:62-80; RS:1372-1379 -->

### Requirement: Learning queue is rebuilt from saved cards (baseline)

At load every active-locale card in a learning step SHALL enter an in-memory queue with `dueAt` equal to
its `stepStartedAt` plus its step length. A learning card with no `stepStartedAt` SHALL first be stamped
with now and saved, so reloads share one anchor. The lookup SHALL find the first card with that id in
any locale, so a non-first language can take its state from another language's card (looks like a bug,
#2247). A timer SHALL re-render at the earliest future `dueAt`.

#### Scenario: Reload during a step
- **WHEN** an `en` card is 30 seconds into a 60-second step and the page reloads
- **THEN** it comes due 30 seconds later

#### Scenario: Reload with a Japanese card in a step
- **WHEN** `ja` is active, a `ja` card is mid-step and the `en` card with that id has no `stepStartedAt`
- **THEN** `dueAt` is now plus a step length, so the wait restarts (#2247)

#### Scenario: App closed during a step
- **WHEN** the app reopens after the step has passed
- **THEN** the card is due at once

<!-- source: RS:1327-1343; RS:1472-1488; RS:172-182; components/review/useLearningQueueTimer.ts:29-64; components/review/ReviewSession.test.tsx:850; components/review/ReviewSession.test.tsx:871; components/review/useLearningQueueTimer.test.tsx:34 -->

### Requirement: Learning cards stay in play whatever the gates say (baseline)

Cards in a learning step SHALL be served regardless of `eligibleCardIds`, so an out-of-scope card, a
disabled-type card and an alternate form with the toggle off all finish their steps. Practice SHALL show
the "Finishing an in-progress card" hint on such a card. A comment says disabled types are never queued,
which is true of the review and new queues only.

#### Scenario: Scope changed mid-step
- **WHEN** a card in a learning step falls out of scope
- **THEN** it is still served, with the hint

#### Scenario: Type turned off mid-step
- **WHEN** cry cards are turned off with a cry card mid-step
- **THEN** after the reload that card is still served once due

<!-- source: lib/review/session.ts:676-688; RS:1475; RS:1928-1930; RS:1945; RS:3228; lib/review/session.test.ts:857; lib/review/session.test.ts:878 -->

### Requirement: Learn-ahead fills an empty queue, else a countdown shows (baseline)

The next card SHALL be the earliest due learning card, then the queues in the order `review-queue` owns.
With nothing else to serve, a learning card due within 20 minutes SHALL be pulled forward. With only
later learning cards the page SHALL show a countdown to the earliest, with the Undo button and counts but
no scope control.

#### Scenario: Due in 19 minutes
- **WHEN** the queues are empty and a learning card is due in 19 minutes
- **THEN** it is shown now

#### Scenario: Due in 21 minutes
- **WHEN** the queues are empty and a learning card is due in 21 minutes
- **THEN** the countdown shows

<!-- source: RS:122-123; RS:1947-1975; RS:2154-2187; RS:739-783; components/review/ReviewSession.test.tsx:1187; components/review/ReviewSession.test.tsx:1231; components/review/ReviewSession.test.tsx:4471 -->

### Requirement: A card on screen stays until it is graded (baseline)

The first card shown SHALL be pinned in `displayedCardId` until a grade releases it, so a learning card
coming due cannot replace it. A revealed card SHALL also be held by a second lock. A scope change SHALL
clear the first lock, and a card that stopped being eligible SHALL lose it, but the reveal lock takes no
account of scope, so a revealed card stays through a scope change until it is graded.

#### Scenario: Learning card comes due before Reveal
- **WHEN** a learning card's `dueAt` passes while another card waits for Reveal
- **THEN** the card on screen does not change

#### Scenario: Scope excludes the unrevealed card
- **WHEN** the scope changes so the unrevealed card on screen is no longer eligible
- **THEN** the next eligible card replaces it

#### Scenario: Scope excludes the revealed card
- **WHEN** the scope changes while the answer is showing
- **THEN** that card stays until it is graded

<!-- source: RS:1044-1059; RS:1741-1786; RS:1994-2012; RS:1015; components/review/ReviewSession.test.tsx:957; components/review/ReviewSession.test.tsx:1078; components/review/ReviewSession.test.tsx:1553 -->

### Requirement: Renderer depends on card type and lifecycle (baseline)

Cry cards SHALL play the cry as the prompt and reveal on request. Reverse cards SHALL use the four-tile sprite
picker, grading Good on a correct tap and Again otherwise, with no grade buttons. With verified typed entry on, a
name card in its learning phase SHALL use four-option multiple choice and a graduated one typed entry. Other cards
SHALL use the reveal flip and grade buttons. The one-time multiple-choice banner is English in every locale (looks
like a bug, #2259).

#### Scenario: Typed mode, new name card
- **WHEN** verified typed entry is on and a brand-new name card comes up
- **THEN** multiple choice shows

#### Scenario: Typed mode off
- **WHEN** verified typed entry is off and a brand-new name card comes up
- **THEN** the Reveal flip shows

#### Scenario: Superuser flag on
- **WHEN** `forceCardsGraduated` is on in typed mode
- **THEN** a name card in its learning phase shows typed entry

#### Scenario: Seed changed under a reverse card
- **WHEN** a reverse card's species has left the seed
- **THEN** the page renders nothing for it

#### Scenario: Japanese interface, multiple-choice banner
- **WHEN** the interface is `ja` and the banner shows
- **THEN** its text is English (#2259)

<!-- source: RS:3136-3247; RS:3251-3263; RS:3301; RS:3349-3367; RS:3373-3382; RS:3418-3428; components/review/SpritePicker.tsx:178-191; components/review/ReviewSession.test.tsx:754; components/review/ReviewSession.test.tsx:4854; components/review/ReviewSession.test.tsx:4912 -->

### Requirement: Reveal shows the answer without a pop-in (baseline)

Reveal SHALL pick a fact for the card, wait for the evolution answer sprite to decode (bounded by the
decoder's time limit), then show the answer, lock the card and play the cry and spoken name by setting.
The cry SHALL finish before the name is spoken. Cry cards SHALL not replay their cry. A cry card SHALL
auto-play once when it first comes on screen. Decoding SHALL block a second reveal, and leaving during
the decode SHALL stop the rest.

#### Scenario: Slow decode
- **WHEN** the decode has not finished on an evolution card
- **THEN** the answer stays hidden until it finishes or times out

#### Scenario: Name card
- **WHEN** a name card is revealed
- **THEN** no decode wait applies

<!-- source: RS:2410-2526; RS:1545-1551; components/review/ReviewSession.test.tsx:545; components/review/ReviewSession.test.tsx:586; components/review/ReviewSession.test.tsx:598; components/review/ReviewSession.test.tsx:619; components/review/ReviewSession.test.tsx:394 -->

### Requirement: Keyboard controls the session (baseline)

Unless focus is in a text field or the language panel is open, `?` SHALL open the shortcut overlay, Escape
SHALL close it, Space or Enter SHALL reveal, and after reveal 1, 2, 4 and 5 SHALL grade with 3 as a second
Good. Cmd or Ctrl+Z SHALL undo. The Space and Enter branch SHALL call `preventDefault` whatever is focused
and SHALL run on picker and multiple-choice cards too, which looks like a bug (#2261).

#### Scenario: Focus in a text field
- **WHEN** an input has focus and Space is pressed
- **THEN** nothing is revealed

#### Scenario: Grade key before reveal
- **WHEN** 1 is pressed before reveal
- **THEN** nothing happens

#### Scenario: Enter on a focused picker tile
- **WHEN** a keyboard user presses Enter on a focused tile of a reverse card
- **THEN** the handler runs the reveal, sets `revealed` and stops the browser's default action (#2261)

<!-- source: RS:1556-1568; RS:1660-1732; RS:2492-2493; components/review/ReviewSession.test.tsx:3960; components/review/ReviewSession.test.tsx:3972; components/review/ReviewSession.test.tsx:3984; components/review/ReviewSession.test.tsx:3997; components/review/ReviewSession.test.tsx:4043; components/review/ReviewSession.test.tsx:4089 -->

### Requirement: Swiping grades a revealed flip card (baseline)

On a revealed flip card, a swipe past 80 pixels SHALL grade: right Good, left Again, up Easy, down Hard.
Swiping SHALL be off while grading, and off on picker, multiple-choice and typed cards, which render no
swipe target.

#### Scenario: Swipe right on a revealed card
- **WHEN** a revealed name card is swiped 100 pixels right
- **THEN** it is graded Good

<!-- source: RS:1647-1653; RS:3171; RS:3459; lib/review/swipeGesture.ts:27; lib/review/swipeGesture.ts:107-115; lib/review/swipeGesture.test.ts:12; lib/review/swipeGesture.test.ts:39 -->

### Requirement: Grade applies in a fixed order (baseline)

A grade SHALL compute the next state, decode the next card's sprites, wait for audio if that setting is on, enqueue
the sync, update the screen, then chain the device save and log write behind any earlier grade. The log SHALL be written only after a successful save. A grade SHALL be dropped when the
page is left during the audio wait, and a queued save step SHALL be skipped after unmount (looks like a bug, #2264).
A `nextReview` error SHALL skip the grade and show a banner.

#### Scenario: Slow disk
- **WHEN** `saveSession` has not resolved
- **THEN** the next card is already on screen

#### Scenario: Save fails
- **WHEN** the save returns not ok
- **THEN** no grade-log entry is written, the banner shows and Undo stays off

#### Scenario: Leaving during the audio wait
- **WHEN** the player navigates away before the audio finishes
- **THEN** the card is not graded

#### Scenario: Corrupt grade value
- **WHEN** `nextReview` throws
- **THEN** the session continues with a localised error banner

<!-- source: RS:2554-2617; RS:2676-2802; RS:2819-2921; RS:2935-2956; components/review/ReviewSession.test.tsx:2013; components/review/ReviewSession.test.tsx:4278; components/review/ReviewSession.test.tsx:4541; components/review/ReviewSession.test.tsx:4586; components/review/ReviewSession.test.tsx:4640 -->

### Requirement: Grades feed the log, streak and daily summary (baseline)

After a successful save a grade SHALL call `recordReview` and append to the grade log with its locale, the local
day and the post-grade step. `dueQueueEmpty` SHALL be true when no active-locale card is due, with no scope or
card-type check, so a scoped session can finish with it false (looks like a bug, #2257). The daily summary SHALL be
saved per grade, unless a superuser flag is on, and restored at load from the summary or else the grade log.

#### Scenario: Reload after a session
- **WHEN** the page reloads on the same local day
- **THEN** Share today is available from the stored summary or the grade log

#### Scenario: Superuser flag on, no summary
- **WHEN** a superuser flag is on and no summary is stored
- **THEN** the grade log fallback is skipped

#### Scenario: Scoped session, due card outside it
- **WHEN** three grades clear everything in scope and a card outside the scope is due
- **THEN** `dueQueueEmpty` is false and the day is not recorded (#2257)

<!-- source: RS:217-258; RS:1443-1470; RS:2960-2987; RS:3009-3023; lib/streak/persistence.ts:31-36; components/review/ReviewSession.test.tsx:2573; components/review/ReviewSession.test.tsx:2599 -->

### Requirement: Undo reverts one grade while it is still on the device (baseline)

Undo SHALL be one step, armed only after the save succeeds and the log entry exists, and SHALL expire when a held
grade commits. Undo by button or shortcut SHALL wait for pending saves, drop the held grade, restore cards, tallies
and the learning queue, save, remove the log entry, roll back the summary and return to the card revealed. It SHALL
NOT restore `priorityNewSpeciesIds` (looks like a bug, #2251) and does not reverse `recordReview`.

#### Scenario: Signed in, undo in time
- **WHEN** a signed-in player undoes before the hold commits
- **THEN** the grade never reaches the cloud

#### Scenario: Guest
- **WHEN** a guest grades and undoes
- **THEN** there is no hold, and undo reverts the device state

#### Scenario: Learn-first species
- **WHEN** a species' last new card is graded and undone
- **THEN** the card is new again and the species stays off the list (#2251)

<!-- source: RS:147-166; RS:1128-1137; RS:1556-1614; RS:2650-2665; RS:2957-2999; RS:3068-3119; components/review/ReviewSession.test.tsx:449; components/review/ReviewSession.test.tsx:4171; components/review/ReviewSession.test.tsx:4191; components/review/ReviewSession.test.tsx:4704; components/review/ReviewSession.test.tsx:4746; components/review/ReviewSession.test.tsx:6105 -->

### Requirement: Superuser flags keep QA out of the cloud, not off the device (baseline)

With any superuser flag on, grade sync SHALL run as signed out. Badges, daily summary, mastered and due caches,
the practice count and the slow-load count SHALL be skipped. Device session saves, the device grade log and
the learn-first list save SHALL still run.

#### Scenario: QA grade
- **WHEN** a card is graded with a flag on
- **THEN** the card is saved on the device and nothing is enqueued for the cloud

<!-- source: RS:1118-1123; RS:1457; RS:1494; RS:2540; RS:2566; RS:2661-2664; RS:2849; RS:2861; RS:2869; RS:2946; RS:3009; RS:3033 -->

### Requirement: Wall checks see every enabled card, not only eligible ones (baseline)

The end-state order and caps are owned by `review-queue`. The "more work exists" checks behind them SHALL use
enabled card types across the active locale's cards, ignoring scope and the alternate-forms toggle. So a wall
can show for cards the session would never serve (looks like a bug, #2255). A disabled type SHALL NOT trigger a
wall. Because `cards` is the active-locale view, another language's cards SHALL NOT trigger one.

#### Scenario: Scoped session at the review cap
- **WHEN** the name cap is reached, nothing in scope is due, and a card outside the scope is due
- **THEN** the review limit screen shows, and Keep reviewing finds nothing to serve (#2255)

#### Scenario: Cry capped and turned off
- **WHEN** cry is at its new cap and disabled
- **THEN** New cards locked does not show

#### Scenario: Another language has work
- **WHEN** only a language other than the active one has due cards
- **THEN** no wall shows

<!-- source: RS:2085-2152; RS:1402-1408; components/review/ReviewSession.test.tsx:2229; components/review/ReviewSession.test.tsx:2324; components/review/ReviewSession.test.tsx:2378 -->

### Requirement: End screen affordances (baseline)

All three end variants SHALL show the tomorrow teaser, Done today pill, accuracy row and Share today when they
apply. The Pokemon of the day and partner SHALL show only on All caught up. With a scope
active, Clear filter SHALL show on All caught up and New cards locked, and the Scope control above any variant. A
switch-language button SHALL show on All caught up when another language has due cards. The accuracy row labels are
English in every locale (looks like a bug, #2259).

#### Scenario: Scope finished
- **WHEN** a scoped session is all caught up
- **THEN** the Scope control and Clear filter both show, and they return after a remount

#### Scenario: Second language has work
- **WHEN** the active language is finished and `ja` has 5 due
- **THEN** a button offers to switch to it

<!-- source: RS:493-519; RS:537-737; RS:2336-2373; components/review/ReviewSession.test.tsx:1684; components/review/ReviewSession.test.tsx:1811; components/review/ReviewSession.test.tsx:2805; components/review/ReviewSession.test.tsx:2950; components/review/ReviewSession.test.tsx:5479 -->

### Requirement: Tomorrow's new-card estimate counts one direction (baseline)

`countNewTomorrow` SHALL count eligible new cards of the first enabled type among name, reverse and cry in the
active locale, capped at that type's new-card limit, and SHALL return 0 when none of them is enabled. Evolution
cards SHALL NOT count.

#### Scenario: Pool larger than the cap
- **WHEN** 900 new name cards are eligible and the cap is 10
- **THEN** the estimate is 10

<!-- source: lib/review/session.ts:1025-1048; RS:2206-2212; components/review/ReviewSession.test.tsx:3126 -->

### Requirement: Higher or Lower is offered from what has been seen (baseline)

The end screens SHALL offer the game according to the seen Pokemon that pass the alternate-forms toggle and scope:
two or more enable it, one shows it disabled with helper text, none hides it. Entering it SHALL swap the summary
for a highlights bar and the game, moving focus to the first tile, and Back SHALL return focus to the button.

#### Scenario: One seen Pokemon
- **WHEN** one Pokemon has been seen
- **THEN** the button is disabled with helper text

<!-- source: RS:1216-1226; RS:1068-1087; RS:2230-2237; RS:2240-2329; RS:2379-2401; components/review/ReviewSession.test.tsx:3391 -->

### Requirement: One-shot nudges wait for their moment (baseline)

During practice, nudges SHALL show above the Scope control in this order: Higher or Lower, scope, Almost mastered,
offline. None SHALL show before the first-visit modal is dismissed. The scope nudge SHALL need an empty scope, a
never-opened scope control and 3 practice sessions. The offline nudge SHALL need no download, no superuser flag, and
3 slow sprite loads or 5 practice sessions. A practice session SHALL count once per tab session, on the first grade.

#### Scenario: Reload in the same tab
- **WHEN** the page reloads and a card is graded in the same browser tab session
- **THEN** the practice count does not rise again

#### Scenario: Already downloaded
- **WHEN** an offline download exists
- **THEN** the offline nudge stays hidden

<!-- source: RS:125-137; RS:942-953; RS:1199-1209; RS:1236-1245; RS:1836-1853; RS:2566-2575; RS:3394-3397; components/review/ReviewSession.test.tsx:5596; components/review/ReviewSession.test.tsx:5688 -->

### Requirement: Queues use the UTC day, personal records the local day (baseline)

Queue building, due comparisons and snooze SHALL use the UTC day. The streak, grade log and daily summary SHALL use
the player's time zone, and the tomorrow teaser SHALL use a local tomorrow against UTC due dates (#2188, #2193).

#### Scenario: Evening in Los Angeles
- **WHEN** it is 20:00 on 1 May in Los Angeles (03:00 UTC on 2 May)
- **THEN** the queue's day is 2 May while the grade log's day is 1 May

<!-- source: RS:1352; RS:1907; RS:2197-2201; RS:2634-2640; lib/review/session.ts:503-505 -->

### Requirement: The no-card-types screen cannot show (baseline)

The "no card types enabled" screen SHALL stay unreachable, because it needs `reverseEnabled` false, which starts
true and is never set. Name and reverse are always on.

#### Scenario: Every optional type off
- **WHEN** evolution, reverse-evolution and cry are all off
- **THEN** name and reverse cards are served and that screen does not show

<!-- source: RS:811; RS:1272; RS:1862-1882 -->

## Reconciling the open deltas

Who owns what, checked against the code at d2456f44. All the overlapping capabilities are unarchived or in
open PRs, so requirement names here are new and nothing collides.

| Capability | Where | Keeps | This spec adds | Not true as written |
|---|---|---|---|---|
| `practice-scope` | `favourite-everywhere`, merged in #2189 | Axes, presets, anchors, storage, snooze rules, no-match screen, caps untouched by scope | When eligibility is computed, what a scope change does, what scope cannot pause | See below |
| `new-card-order` | `favourite-everywhere` | New-card selection, shuffle, priority species, "I already know these" | The undo gap on the priority list | Line citations are stale; the rules hold |
| `review-queue` | `comeback-return-mode`, PR #2194, draft | Review picks, caps, soft wall rule, end-state order, due figures, streak dates | What the wall checks look at, end screen contents, learn-ahead | See below |
| `return-mode` | `comeback-return-mode`, not built | Everything about return mode | Nothing: it is not on `qa` | Not applicable |
| `local-data-and-backup` | PR #2265 | Storage keys, IndexedDB lifecycle, migration, reset, archive, backup | Session parsing and what load does with the result | None found |
| `cloud-sync` | PR #2233 | Queues, merge, pulls, what a commit sends | The session's use of the undo hold | None found |
| `srs-scheduling` | PR #2277 | `nextReview`, steps, typed grading, distractors | When the session calls them | None found |

`practice-scope`, as written:

- "The same eligible-id set SHALL drive the session queue and the app badge counts" is false for the Favourites
  and progress presets (#2253).
- "Progress presets are recomputed per session" holds for the sets, but eligibility is not recomputed after a
  grade, and the load-time incomplete-chains set mixes languages (#2249).
- "This SHALL run on session load and on every scope change" covers only the active locale on a scope change.

`new-card-order`, as written:

- "All callers of `buildSessionQueues` SHALL pass the same list" holds for `ReviewSession`'s four calls. The Stats
  helper passes none, which does not change a count.
- "Desynced species are ranked first among groups" is true of the code and has no visible effect (#2188).

`review-queue`, as written:

- "Due badges" is false for the same presets as above (#2253).
- "Study days" says a day joins "or no review is due", which ignores scope (#2257).

## Clarifications

All dated 2 November 2026; open calls, each with a recommendation. Nothing here has been decided by the owner.

- Where does a baseline live? Written straight into `openspec/specs/`, as #2233, #2265 and #2277 do, so there is no
  change folder or archive step.
- Should the deltas be edited to match? Recommendation: no, not here. When a delta's PR next moves, or when each
  issue above is fixed, MODIFY the requirement there.
- `favourite-everywhere` merged on 26 October with every task ticked but is still active on `qa`, so its specs are
  not in `openspec/specs/`. Recommendation: check the archive bot alongside the open failures #2192 and #2195.
- #2193's first bullet says wall checks ignore the active locale. That is not true: they read the active-locale
  view (RS:1402-1408). #2188's bullet that an Almost mastered scope counts every card on the push route is out of
  date: `isPresetId` now keeps the preset, so it matches nothing. Recommendation: correct both issue bodies. Left
  alone here because changing shared issue text needs the owner's yes.
- Should a disabled type's card in a learning step still be served? It is today, and RS:1928-1930 says otherwise.
  Recommendation: keep the behaviour, because finishing the step protects FSRS state, and fix the comment. No issue
  filed.
- Should a revealed card survive a scope change? It does today. Recommendation: keep it, so a grade cannot land on
  a different card. No issue filed.
- #2255 is marked deliberate in the code (#835). Recommendation: judge it as a product call in that issue.
- `comeback-return-mode` adds an end variant and pauses new cards. Recommendation: when #2194 is built, it should
  MODIFY "End screen affordances" and "Learn-ahead fills an empty queue, else a countdown shows" if their text
  stops being true.
- Scenarios with no direct test, read from code: seed failure and skeleton, one bad card replacing the session
  (#2280), the audio-wait exit, the superuser list, the time-zone example, and every multi-language case in
  "Eligible set is fixed between scope changes" and "Learning queue is rebuilt from saved cards".
- #2261 has not been tried in a real browser: Chromium was not installed for this run. Recommendation: confirm it
  by hand with a keyboard before fixing.
