## Purpose

How Poké Memory chooses and orders new (never-graded) cards for a practice session: which cards
exist and are eligible, the per-direction daily new-card cap, the stable per-day shuffle, the
species grouping of name, reverse and cry cards, the one existing priority rule, and how the
"Mark Pokémon I already know" quiz takes cards out of the new pool. This baseline records current
behaviour on `qa` before #2187 adds an opt-in "learn your favourite's evolution line next" that
moves chosen species to the front of the new-card queue within the daily cap. Change favourite-everywhere (#2187) adds priority species.

## ADDED Requirements

### Requirement: Which new cards exist (baseline, current behaviour)

The session SHALL hold name and reverse cards for every seed species, always. Evolution,
reverse-evolution and cry cards SHALL be added only when their setting is on, and cry cards SHALL
be created only for species with a cry. Each card SHALL belong to one name locale, and each
locale SHALL have its own cards and its own daily budget. Turning a direction off SHALL keep its
saved cards but SHALL NOT add new ones.

#### Scenario: Cry cards on, species without a cry

- **WHEN** cry cards are on and an alternate form has `cryUrl: null`
- **THEN** no cry card is created for it

#### Scenario: Direction turned off

- **WHEN** reverse-evolution cards are turned off after some were graded
- **THEN** the saved cards are kept in storage but no new reverse-evolution cards are added

<!-- source: lib/review/session.ts:170-233; lib/review/session.ts:420-494; lib/review/seedOpts.ts:17-33; lib/review/session.test.ts:420-443; lib/review/session.test.ts:1782; lib/review/session.ts:684-690 -->

### Requirement: What counts as a new-card candidate (baseline, current behaviour)

A card SHALL be a new-card candidate only when it is in the active locale, has never graduated
(`lastReview` is null), is not in a learning step, and is in the eligible-card set (card type on,
alternate-forms toggle, practice scope). Alternate-form cards SHALL be excluded when the
alternate-forms toggle is off and SHALL share their direction's budget when it is on.

#### Scenario: Card in a learning step

- **WHEN** a card was graded Again today and is on learning step 0
- **THEN** it is in the learning queue, not the new queue

#### Scenario: Alternate forms off

- **WHEN** `alternateFormsEnabled` is false
- **THEN** Alolan Raichu (id 10100) is never a new-card candidate

<!-- source: lib/review/session.ts:689-709; lib/review/scope.ts:401-419; lib/eligibility/index.ts:136-160; lib/review/session.test.ts:826; lib/review/session.test.ts:1826-1858 -->

### Requirement: Daily new-card cap per direction (baseline, current behaviour)

Each direction bucket (name, evolution, reverse, cry) SHALL have its own new-card cap from
settings, defaulting to 10, 5, 10 and 10. Reverse-evolution cards SHALL share the evolution
bucket. The remaining budget SHALL be the cap minus the cards in that bucket whose `firstSeen` is
today (never below 0), counted over all active-locale cards whatever the scope.

#### Scenario: Name budget spent, reverse not

- **WHEN** 10 name cards and 4 reverse cards were introduced today with caps of 10 each
- **THEN** no new name card and at most 6 new reverse cards are offered

#### Scenario: Reverse-evolution shares the evolution budget

- **WHEN** an evolution cap is 5 and 3 forward plus 2 reverse-evolution cards were introduced today
- **THEN** no further evolution-bucket new cards are offered

<!-- source: lib/review/session.ts:99-122; lib/review/session.ts:689-697; lib/review/session.ts:749-754; components/review/ReviewSession.tsx:182-201; components/review/ReviewSession.tsx:1888-1901; components/review/ReviewSession.tsx:2103-2129; lib/review/session.test.ts:727-800; lib/review/session.test.ts:534 -->

### Requirement: Extended review does not raise new-card caps (baseline, current behaviour)

Extended review
SHALL NOT raise new-card caps. When a bucket is spent and new cards of that type remain, the end
state SHALL be "new cards locked".

#### Scenario: Bucket spent

- **WHEN** the name bucket is spent and new name cards remain
- **THEN** extended review adds no new name cards and the end state is "new cards locked"

### Requirement: Stable shuffle per user per day (baseline, current behaviour)

Every ordering step SHALL use `stableShuffleForDay`, which sorts ids by an FNV-1a hash of the
date string, a per-user salt and the id (ties broken by id). The salt SHALL be the Supabase user
id when signed in and a per-device random UUID kept in local storage for guests. The date SHALL be
the UTC date (`todayString(new Date())`). The same user on the same day SHALL get the same order
on every call, and the order SHALL change from day to day and between users.

#### Scenario: Reload mid-day

- **WHEN** the same user reloads Practice twice on the same UTC day with the same cards
- **THEN** the new queue is in the same order both times

#### Scenario: Next day

- **WHEN** the same ids are shuffled on a different day
- **THEN** the order differs

<!-- source: lib/review/session.ts:507-524; lib/review/session.ts:649; components/review/ReviewSession.tsx:1126-1136; lib/identity/clientSalt.ts:17-31; components/review/ReviewSession.tsx:1888; lib/review/session.test.ts:1388-1467 -->

### Requirement: Selection is pre-sliced per direction, then grouped by species (baseline, current behaviour)

For name, reverse and cry, each direction's candidates SHALL be shuffled and cut to that
direction's remaining budget on its own. The cut lists SHALL then be grouped by species, and a
species group SHALL be admitted only when every direction in the group still has budget, taking
one from each.

#### Scenario: Partner introduced on an earlier day

- **WHEN** species 1's name card graduated yesterday and its reverse card is new
- **THEN** the reverse card is admitted on its own

#### Scenario: Name cap of 1, two fresh species

- **WHEN** the name cap is 1, the reverse cap is 10 and species 1 and 2 have new name and reverse cards
- **THEN** one name card and both reverse cards are admitted, one reverse paired with the admitted name

<!-- source: lib/review/session.ts:723-847; lib/review/session.ts:552-588; lib/review/session.test.ts:1163-1300; lib/review/session.test.ts:1314-1386 -->

### Requirement: Unpaired directions and evolution cards (baseline, current behaviour)

A direction whose partner card is not in the group (graduated earlier, or not in
its own cut list) SHALL be admitted alone. Evolution and reverse-evolution cards SHALL be shuffled
and cut to the evolution budget separately, with no species grouping.

#### Scenario: Partner already graduated

- **WHEN** a species' reverse card graduated earlier and its name card is new
- **THEN** the name card is admitted alone

### Requirement: Desynced species are ranked first among groups (baseline, current behaviour)

Before admission, species groups SHALL be split into two tiers, each in stable-shuffle order:
tier 1 holds species where exactly one of name or reverse is a new candidate and the other leg
has already been graded; tier 2 holds the rest. Groups SHALL be considered tier 1 first. This is
the only existing rule that ranks particular species, and it SHALL NOT change counters, FSRS
state or the review queue. There SHALL be no setting or input that ranks chosen species ids.

#### Scenario: One leg already graded

- **WHEN** species 10's name card is graduated and its reverse card is new, and species 20 is fully new
- **THEN** species 10's group is considered before species 20's

<!-- source: lib/review/session.ts:777-823; lib/review/session.test.ts:2578-2690 -->

### Requirement: Final queue order and serving order (baseline, current behaviour)

The admitted name, reverse and cry ids and the evolution slice SHALL be joined and then shuffled
again with the same stable shuffle, and that shuffled list SHALL be the session's new queue. The
session SHALL serve a due learning card first, then the first review-queue card, and only when the
review queue is empty the first new-queue card. The new queue SHALL be rebuilt on every render
and after every grade from the current card states.

#### Scenario: Reviews waiting

- **WHEN** both the review queue and the new queue have cards and no learning card is due
- **THEN** the next card is from the review queue

<!-- source: lib/review/session.ts:847-873; lib/review/session.ts:879-886; components/review/ReviewSession.tsx:1912-1940; components/review/ReviewSession.tsx:2647-2654; lib/review/session.test.ts:1113; lib/review/session.test.ts:1302 -->

### Requirement: "I already know these" takes cards out of the new pool (baseline, current behaviour)

The "Mark Pokémon I already know" quiz on the Settings page SHALL list only name cards in the
current name locale that have never been touched (`lastReview` and `firstSeen` both null),
leaving out alternate forms when the toggle is off. Applying it SHALL grade each chosen card Easy
through `nextReview`, which graduates it at once with `firstSeen` and `lastReview` set to today,
so it leaves the new pool. Reverse, cry and evolution cards for that species SHALL stay new.

#### Scenario: Marking Pikachu as known

- **WHEN** the user marks Pikachu in the quiz and applies it
- **THEN** Pikachu's name card is a graduated review card due in the future and its reverse card is still a new-card candidate

<!-- source: lib/onboarding/applyKnownGrades.ts:38-108; components/onboarding/KnownPokemonQuiz.tsx:185-194; lib/srs/scheduler.ts:366-388; lib/onboarding/applyKnownGrades.test.ts:50-70; lib/onboarding/applyKnownGrades.test.ts:162 -->

### Requirement: Priority species are introduced first, within the daily cap

When `priorityNewSpeciesIds` is not empty, each direction's new-card candidates whose species is on
the list SHALL be placed first, in list order, before that direction's list is cut to its daily
budget (name, reverse and cry before the cut at the per-direction slice; evolution likewise). After
the final reshuffle, the admitted priority cards SHALL be served before the other new cards.

#### Scenario: Learn Gengar's line next

- **WHEN** `priorityNewSpeciesIds` is Gastly, Haunter, Gengar, the name cap is 10 and none of them has been seen
- **THEN** today's new name cards include all three, served before the other seven new name cards

### Requirement: Priority keeps caps and scope, and empties itself

Daily caps, eligibility and scope SHALL be unchanged: a priority species outside the current scope is not
introduced. A species SHALL leave the list once every one of its enabled-direction cards in the active
locale has been introduced. All callers of `buildSessionQueues` SHALL pass the same list.

#### Scenario: Same list everywhere

- **WHEN** `ReviewSession` builds queues at any of its call sites
- **THEN** each passes the same `priorityNewSpeciesIds`

#### Scenario: Cap already used

- **WHEN** the day's new name budget is already spent
- **THEN** no priority card is introduced today and the list is kept for tomorrow

#### Scenario: Scope excludes the line

- **WHEN** the scope is Legendaries only and the priority species are not legendary
- **THEN** none of them is introduced and the list is kept

#### Scenario: Fully introduced

- **WHEN** the last enabled-direction card of Gastly in the active locale is introduced
- **THEN** Gastly is removed from `priorityNewSpeciesIds` and the change syncs like any setting

