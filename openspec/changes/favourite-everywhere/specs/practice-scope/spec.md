## Purpose

The Practice "Scope" control narrows which cards a practice session offers: by generation, type,
preset group (Starters, Legendaries, Incomplete evolution chains, Almost mastered), game and,
when alternate forms are on, form category. This baseline records current behaviour on `qa`
before #2187 adds a "Favourites" preset. It covers how presets are defined and combined, how the
scope is stored and synced, what happens when nothing matches, and how scope interacts with the
daily new and review caps. Change favourite-everywhere (#2187) adds the Favourites preset and one shared preset list.

## ADDED Requirements

### Requirement: An empty scope matches every card (baseline, current behaviour)

The scope SHALL have five axes (`gens`, `types`, `presets`, `games`, `formCategories`). The scope
SHALL count as empty when every list is empty and `formCategories` is `{mode: "all"}` (or absent),
and an empty scope SHALL match every card. The chip label for an empty scope SHALL read
"All Pokémon".

#### Scenario: New user with no scope

- **WHEN** the scope is `EMPTY_SCOPE`
- **THEN** `isScopeEmpty` is true, `cardMatchesScope` returns true for every card and the chip reads "All Pokémon"

#### Scenario: Form filter alone makes the scope active

- **WHEN** only `formCategories` is set to `{mode: "default-only"}`
- **THEN** `isScopeEmpty` is false

<!-- source: lib/eligibility/scopeConstants.ts:18-34; lib/review/scope.ts:246; lib/review/scope.ts:628; lib/review/scope.test.ts:51; lib/review/scope.test.ts:653-672 -->

### Requirement: Axes are combined with OR, the form filter with AND (baseline, current behaviour)

A card SHALL pass a non-empty scope when it matches at least one active axis among gens, types,
presets and games. Within an axis, a card SHALL match when any listed value applies. An empty
axis SHALL add nothing to the OR. The form-category filter SHALL be applied first as a hard
filter: `default-only` keeps only default forms, `include` keeps default forms plus the listed
categories, `all` keeps everything. There SHALL be no AND between gens, types, presets and games.

#### Scenario: Gen I plus Fire

- **WHEN** the scope is `gens: [1], types: ["fire"]`
- **THEN** a Gen I Normal-type card passes (gens axis) and a Gen II Fire-type card passes (types axis)

#### Scenario: Two presets together

- **WHEN** the scope is `presets: ["starters", "legendaries"]`
- **THEN** a card passes if its species is a starter or a legendary

#### Scenario: Form filter overrides the OR

- **WHEN** the scope is `gens: [1], formCategories: {mode: "default-only"}` and the card is Alolan Raichu (species 26, Gen I)
- **THEN** the card is excluded even though another axis could match

<!-- source: lib/review/scope.ts:148-204; lib/review/scope.test.ts:75; lib/review/scope.test.ts:227; lib/review/scope.test.ts:700-760; lib/eligibility/scopePredicate.test.ts:352-390 -->

### Requirement: Preset groups are fixed lists or progress-derived sets (baseline, current behaviour)

The `starters` preset SHALL match the 27 species in `STARTER_IDS` (three per generation, Gens I
to IX). The `legendaries` preset SHALL match seed species with `isLegendary` true (mythicals are
not included). The `incomplete-chains` preset SHALL match species in an evolution family the user
has started but not finished mastering, and the `mastery-blockers` ("Almost mastered") preset
SHALL match species where exactly one practice leg is mastered.

#### Scenario: Starters preset

- **WHEN** the scope is `presets: ["starters"]`
- **THEN** Bulbasaur (1) and Snivy (495) match and Eevee does not

<!-- source: lib/review/scope.ts:21; lib/review/scope.ts:36-49; lib/review/scope.ts:101-114; lib/review/scope.ts:187-198; lib/pokemon/starterIds.ts:12-22; lib/evolution/chains.ts:253-264; components/review/ScopeControl.tsx:54; components/review/ReviewSession.tsx:1348-1363; lib/review/scope.test.ts:68; lib/review/scope.test.ts:240-316 -->

### Requirement: Progress presets are recomputed per session (baseline, current behaviour)

Both progress presets SHALL be recomputed by `ReviewSession` from the card set and passed in as `ScopeMatchContext`; when the
context set is missing or empty they SHALL match nothing. The Groups section SHALL offer, in
order, starters, legendaries, incomplete chains, almost mastered and (only while there are hearts)
favourites; before this change it offered the first four only.

#### Scenario: Progress preset without context

- **WHEN** the scope is `presets: ["incomplete-chains"]` and no `incompleteChainSpeciesIds` set is supplied
- **THEN** no card matches

### Requirement: Each card is matched through one anchor species (baseline, current behaviour)

Name, reverse and cry cards SHALL be matched on their own species, using `speciesId` (the base
species) for the generation of an alternate form. Evolution and reverse-evolution cards SHALL be
matched on the pre-evolution species for every axis (generation, types, presets, games) and SHALL
be treated as default forms by the form filter.

#### Scenario: Fire scope and evolution cards

- **WHEN** the scope is `types: ["fire"]`
- **THEN** Charmander to Charmeleon matches and Eevee to Flareon does not (Eevee is Normal)

#### Scenario: Starters and an evolution edge

- **WHEN** the scope is `presets: ["starters"]`
- **THEN** Bulbasaur to Ivysaur matches because Bulbasaur is a starter

<!-- source: lib/review/scope.ts:256-301; lib/review/scope.test.ts:145-235; lib/review/scope.test.ts:262 -->

### Requirement: Scope is the last of three eligibility gates (baseline, current behaviour)

A card SHALL be eligible for the session only when its card type is enabled (name and reverse
always; evolution, reverse-evolution and cry by setting), then when it passes the alternate-forms
master toggle (species id 10000 or above excluded when off), and finally when it passes the
scope. The same eligible-id set SHALL drive the session queue and the app badge counts. The
form-category section SHALL be hidden in the Scope panel while the alternate-forms toggle is off.

#### Scenario: Alternate form with the toggle off

- **WHEN** `alternateFormsEnabled` is false and the scope is empty or includes all forms
- **THEN** an alternate-form card is not eligible

<!-- source: lib/review/scope.ts:401-419; lib/eligibility/index.ts:107-163; components/review/ScopeControl.tsx:355; lib/review/scope.test.ts:779-860 -->

### Requirement: Scope is saved in settings and synced as one value (baseline, current behaviour)

Every scope change SHALL be written immediately to `UserSettings.practiceScope` in local storage,
and the same write SHALL set the onboarding flags `practiceScopeNudgeDismissed` and
`scopeEverOpened`. For a signed-in user the change SHALL be pushed to the cloud as a whole
top-level `practiceScope` key through `merge_user_settings` (no per-axis merge).

#### Scenario: Signed-in scope change

- **WHEN** a signed-in player adds Fire to the scope
- **THEN** `practiceScope` is saved locally at once and pushed as one whole top-level key

<!-- source: components/review/ReviewSession.tsx:946-961; lib/settings/persistence.ts:643-692; lib/settings/persistence.ts:802; components/sync/AutoSyncOnChange.tsx:53-75; lib/settings/lastPushedSnapshot.ts:61-66; lib/review/scope.ts:570-589; lib/settings/persistence.test.ts:341-505 -->

### Requirement: Stored scope is validated on load (baseline, current behaviour)

On load the stored value SHALL be validated: gens must be whole numbers 1 to 9 (deduplicated), types must be
strings, unknown presets are dropped, and a missing `formCategories` or `games` defaults to
`all` or `[]`. A malformed value (a non-array axis, a gen out of range, a non-string type) SHALL
reset the whole scope to empty. A scope stored under the pre-#333 legacy key SHALL be copied into
settings once and the legacy key cleared.

#### Scenario: Out-of-range generation in storage

- **WHEN** the stored scope is `gens: [0]`
- **THEN** `loadSettings().practiceScope` is the empty scope

#### Scenario: Unknown preset in storage

- **WHEN** the stored presets are `["starters", "banana", "legendaries"]`
- **THEN** the loaded presets are `["starters", "legendaries"]`

### Requirement: Cards hidden by scope are snoozed, not left to age (baseline, current behaviour)

When a graduated card (not new, not in a learning step) falls out of scope, its `hiddenSince`
SHALL be set to today. When it comes back into scope (including when the scope is cleared), its
`dueDate` SHALL move forward by the days it was hidden, capped at 365 and never negative, and
`hiddenSince` SHALL be cleared. This SHALL run on session load and on every scope change.

#### Scenario: Card back in scope after a week

- **WHEN** a card hidden on 1 May returns to scope on 8 May
- **THEN** its due date moves forward 7 days and `hiddenSince` is null

<!-- source: lib/review/filters.ts:66-99; components/review/ReviewSession.tsx:974; components/review/ReviewSession.tsx:1364; lib/review/filters.test.ts:86-160; lib/review/filters.test.ts:237 -->

### Requirement: A scope that matches nothing shows an empty state (baseline, current behaviour)

The Scope panel SHALL show a live "{match} of {total} Pokémon match" count over the seed (with
alternate forms left out when the toggle is off), shown in red when the match is 0. When the
scope is not empty and the eligible-card set is empty, the Practice page SHALL show "No Pokémon
match your scope" with a "Clear scope" button that resets the scope to empty.

#### Scenario: Nonexistent type

- **WHEN** the stored scope is `types: ["nonexistent-type"]`
- **THEN** the page shows the no-match message and tapping "Clear scope" returns to a practice card

<!-- source: components/review/ScopeControl.tsx:165-171; components/review/ScopeControl.tsx:215-223; components/review/ScopeControl.tsx:435-446; components/review/ReviewSession.tsx:1869-1885; components/review/ReviewSession.tsx:2318-2329; e2e/practice-scope.spec.ts:300-365; lib/review/scope.test.ts:486 -->

### Requirement: The Clear control shows while a scope is active (baseline, current behaviour)

The panel SHALL
offer a "Clear" button whenever the scope is active, and the end-of-session screen SHALL show the
Scope control when a scope is active.

#### Scenario: Active scope

- **WHEN** a scope is active
- **THEN** the panel offers Clear and the end-of-session screen shows the Scope control

### Requirement: Scope never resets the daily caps (baseline, current behaviour)

The daily new and review counters SHALL be computed over every card in the active locale,
whatever the scope, so changing scope mid-day SHALL NOT give a fresh new-card or review budget.
Scope SHALL only filter which cards become candidates. A card already in a learning step SHALL
stay in the learning queue even when it falls out of scope, and the session SHALL report it as an
out-of-scope learning card. Extended review SHALL lift only the review caps, never the new caps.

#### Scenario: Toggling scope after reaching the new-card cap

- **WHEN** the user has introduced 10 name cards today (cap 10) and then changes scope
- **THEN** no further new name cards are offered today

#### Scenario: Empty eligible set

- **WHEN** `eligibleCardIds` is empty
- **THEN** the review and new queues are empty but the counters are unchanged

<!-- source: lib/review/session.ts:655-663; lib/review/session.ts:675-709; components/review/ReviewSession.tsx:1888-1918; lib/review/session.test.ts:840; lib/review/session.test.ts:856-934 -->

### Requirement: The daily push count uses a server copy of the scope check (baseline, current behaviour)

The daily Web Push route SHALL apply the card-type and alternate-forms gates and then a server
copy of the scope predicate (`scopeMatchesEntry`) that matches gens, types, `starters`,
`legendaries`, games and form categories with the same OR and AND rules. The progress presets
SHALL match nothing on the server because it has no review state. Cards the route cannot resolve
SHALL be counted rather than dropped.

#### Scenario: Incomplete chains on the server

- **WHEN** a user's scope is `presets: ["incomplete-chains"]`
- **THEN** the push route counts no cards from that preset

<!-- source: lib/eligibility/scopePredicate.ts:58-109; app/api/push/send-daily/route.ts:450-475; lib/eligibility/scopePredicate.test.ts:205-235 -->

### Requirement: A "Favourites" preset matches hearted species

The Scope control SHALL offer a "Favourites" preset whenever `heartedSpeciesIds` holds at least one
species. The preset SHALL match a card whose anchor species is in `heartedSpeciesIds` at the time of
matching, so hearting or un-hearting a species changes the match without editing the scope. With no
hearts the preset SHALL be hidden from the control, and a saved scope that still contains it SHALL
match nothing on that axis (as the progress presets do with no data).

#### Scenario: Practise your hearts

- **WHEN** Pikachu and Gengar are hearted and the scope is only the Favourites preset
- **THEN** the session holds only Pikachu's and Gengar's cards (and evolution cards anchored on them)

#### Scenario: Un-heart everything

- **WHEN** the scope is Favourites and the player removes their last heart
- **THEN** the preset disappears from the control and the Practice page shows "No Pokémon match your scope" with Clear scope

#### Scenario: Japanese interface

- **WHEN** the app language is `ja`
- **THEN** the Favourites preset label comes from the message catalogue in Japanese

### Requirement: Presets come from one shared list

The settings validator, the client matcher, the Scope control, the scope label and the server
push-count predicate SHALL take the set of preset ids from one exported list, so a preset known to
one of them is known to all. A test SHALL fail if any of them names a preset id that is not on the
list. Because the validator now reads the shared list, a saved "Almost mastered" preset SHALL survive
a reload and a cloud pull (it is dropped today).

#### Scenario: Reload keeps the preset

- **WHEN** the scope is Favourites (or Almost mastered) and the page reloads or a cloud pull applies settings
- **THEN** the scope still contains that preset

#### Scenario: An older app version on another device

- **WHEN** a device on the previous release loads a settings blob whose scope contains Favourites
- **THEN** it drops the preset locally but does not push the shortened scope unless the player edits the scope on that device

### Requirement: The daily push count matches hearted species

The server copy of the scope check SHALL match the Favourites preset against `heartedSpeciesIds` read
from the same settings row, so the daily reminder counts the due cards of hearted species.

#### Scenario: Reminder with a Favourites scope

- **WHEN** a signed-in player's scope is Favourites with 3 hearted species and 4 of their cards are due
- **THEN** the daily push counts 4 due cards
