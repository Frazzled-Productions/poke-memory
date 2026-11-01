# pokedex-and-pasture Specification

## Purpose
How a player browses species and sees their progress: the Pokédex grid and detail pages, the Pasture
and its biome views, cries and spoken names, the seed data behind them, the sprites they draw, and the
Higher or Lower rules. This is the baseline: current behaviour on `qa` at d2456f44, written from code
and tests, not what it should be. A requirement that records behaviour which looks wrong says so and
names the issue. Line references are to that commit. The favourite Pokémon and heart controls are out
of scope here: they belong to the favourite-everywhere work (#2187), and are named only where they
share a surface. Mastery rules, sync and stats have their own capabilities.

## Requirements

### Requirement: Grid lists one tile per species (baseline)

The Pokédex page SHALL show one tile per default form, wait for the seed before reading the session,
and reload when the session storage key changes. Without a saved session it SHALL build a fresh one.

#### Scenario: Alternate forms are not tiles

- **WHEN** the seed holds Raichu and Alolan Raichu
- **THEN** the grid shows one Raichu tile and the header total counts default forms only

#### Scenario: Seed not loaded

- **WHEN** the page renders before the seed resolves
- **THEN** it shows the loading skeleton and the header placeholder

Source: `app/pokedex/page.tsx:27`, `app/pokedex/page.tsx:40`, `app/pokedex/page.tsx:66`, `app/pokedex/page.tsx:90`, `app/pokedex/page.tsx:100`, `components/pokedex/PokedexGrid.tsx:230`, `app/pokedex/page.test.tsx:1`.

### Requirement: Grid class comes from the name card, and is not language-aware (baseline)

The page SHALL class each tile from a name card only: `locked` when never graded, `mastered` at
stability of at least 21 days, otherwise `learning`, and `locked` when there is no card. It hydrates
with no language, so `hydrateSession` adds an `en` name card for every species without one, and the
last name card for an id SHALL decide its class. This looks wrong for anyone studying in another
language: #2290. It also differs from the detail page: #2296.

#### Scenario: Only a Japanese card exists

- **WHEN** a species has one reviewed `ja` name card and no `en` card
- **THEN** an unseen `en` card is appended and the tile reads `locked`

#### Scenario: Healed session is saved

- **WHEN** hydration heals an invalid card
- **THEN** the page saves the hydrated list, appended cards included

Source: `app/pokedex/page.tsx:33`, `app/pokedex/page.tsx:36`, `app/pokedex/page.tsx:50`, `app/pokedex/page.tsx:79`, `lib/review/session.ts:270`, `lib/stats/derive.ts:84`, `lib/pokemon/filter.ts:25`.

### Requirement: Introduced count (baseline)

The header SHALL show introduced species out of the default-form total, where introduced counts name
cards with a `lastReview`, across every language and including alternate forms.

#### Scenario: Same species in two languages

- **WHEN** a species has reviewed `en` and `ja` name cards
- **THEN** it adds two to the introduced count (#2290)

Source: `app/pokedex/page.tsx:70`, `app/pokedex/page.tsx:93`.

### Requirement: Tile appearance by class (baseline)

A tile SHALL link to `/pokedex/<id>` and always show its zero-padded number. Mastered tiles SHALL be
emerald with a tick, learning tiles amber with a dot and a grey dimmed sprite, locked tiles zinc with
a black silhouette. Superuser `pretendAllMastered` SHALL render every tile as mastered.

#### Scenario: Locked tile

- **WHEN** a tile is locked
- **THEN** the sprite is `brightness-0`, the link is labelled `Pokémon #NNN` and the alt is `#NNN (locked)`

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** every tile and generation count reads as mastered, and no card changes

Source: `components/pokedex/PokedexGrid.tsx:53`, `components/pokedex/PokedexGrid.tsx:65`, `components/pokedex/PokedexGrid.tsx:74`, `components/pokedex/PokedexGrid.tsx:142`, `components/pokedex/PokedexGrid.tsx:147`, `components/pokedex/PokedexGrid.tsx:193`.

### Requirement: Locked names stay out of sight but not out of the DOM (baseline)

A locked tile SHALL show no visible name, and SHALL still render the English name in an `sr-only`
span. This looks wrong, since a screen reader hears what the tile hides: #2297.

#### Scenario: Screen reader on a locked tile

- **WHEN** a screen reader moves through a locked tile
- **THEN** it reads the number label and then the English species name

Source: `components/pokedex/PokedexGrid.tsx:159`, `components/pokedex/PokedexGrid.tsx:160`.

### Requirement: Grid names follow the Pokémon-name language (baseline)

A revealed tile SHALL show the active language's name with a matching `lang` attribute, falling back
to English until the sidecar loads. The names load once per language change and a stale load SHALL
be discarded. English uses no overrides.

#### Scenario: Language changes during the load

- **WHEN** the language changes while names are loading
- **THEN** the earlier result is dropped

Source: `components/pokedex/PokedexFiltered.tsx:114`, `components/pokedex/PokedexFiltered.tsx:126`, `components/pokedex/PokedexGrid.tsx:60`, `components/pokedex/PokedexGrid.tsx:163`, `components/pokedex/PokedexGrid.locale.test.tsx:111`.

### Requirement: Generation sections and flat list (baseline)

National order SHALL group tiles under generation headings with a mastered count over the filtered
total, and omit empty generations. A generation filter SHALL show that one section. Any other sort
SHALL show a flat list with no headings. An empty result SHALL show a message and a clear link. The
heading text, message and link are English in every language: #2298.

#### Scenario: Alphabetical sort with a generation filter

- **WHEN** the sort is alphabetical and `gen=3` is set
- **THEN** only generation 3 tiles show, in one flat list

Source: `components/pokedex/PokedexFiltered.tsx:227`, `components/pokedex/PokedexGrid.tsx:300`, `components/pokedex/PokedexGrid.tsx:317`, `components/pokedex/PokedexGrid.tsx:336`, `components/pokedex/PokedexGrid.tsx:355`, `lib/stats/generationOf.ts:14`.

### Requirement: Filters live in the URL (baseline)

Filters SHALL be read from `q`, `type` (comma list), `gen`, `forms=1` and `mastery`, and SHALL be
written with `router.replace` without scrolling, leaving out defaults. An unknown `mastery` SHALL read
as all, and a non-numeric `gen` as none. The filter panel SHALL start collapsed, stay in the DOM, and
show a count of active filter axes only while collapsed.

#### Scenario: Mastery filter chosen

- **WHEN** the player picks Mastered
- **THEN** the URL gains `mastery=mastered` and no history entry is added

#### Scenario: Collapsed badge

- **WHEN** two axes are active and the panel is closed
- **THEN** the badge shows 2, and it disappears when the panel opens

Source: `lib/pokemon/filter.ts:143`, `components/pokedex/PokedexFiltered.tsx:23`, `components/pokedex/PokedexFiltered.tsx:37`, `components/pokedex/PokedexFiltered.tsx:105`, `components/pokedex/PokedexFiltered.tsx:255`, `components/pokedex/PokedexFiltered.tsx:283`, `components/pokedex/PokedexFiltered.test.tsx:284`, `components/pokedex/PokedexFiltered.test.tsx:454`.

### Requirement: Search filters at once and writes the URL after 150 ms (baseline)

The search box SHALL filter from local state on every keystroke and update the URL after a 150 ms
debounce. The local value is seeded once and never follows the URL afterwards, so an external URL
change does not clear it. This looks wrong: the empty state's clear link leaves the grid empty, #2291.

#### Scenario: Clear filters after an empty search

- **WHEN** a search has no match and the player follows the link to `/pokedex`
- **THEN** the URL is clean, the local query remains and the grid stays empty

#### Scenario: Typing

- **WHEN** the player types `bul`
- **THEN** tiles narrow immediately and `q=bul` reaches the URL after the debounce

Source: `components/pokedex/PokedexFiltered.tsx:110`, `components/pokedex/PokedexFiltered.tsx:143`, `components/pokedex/PokedexFiltered.tsx:206`, `components/pokedex/PokedexGrid.tsx:306`, `components/pokedex/PokedexFiltered.test.tsx:529`.

### Requirement: Filter matching (baseline)

The query SHALL match, case-insensitively after trimming, the English name or any alternate form's
display name, and in another language also the local name and its transliteration. Locked species
match too. Types SHALL be AND. Generation SHALL use the species id. `forms` SHALL keep species with a
non-default form. Mastery `new`, `learning` and `mastered` SHALL map to `locked`, `learning` and
`mastered` classes.

#### Scenario: Form name search

- **WHEN** the query is `alolan`
- **THEN** species with an Alolan form match

#### Scenario: Romaji search

- **WHEN** the language is `ja` and the query is the rōmaji of a name
- **THEN** that species matches once the sidecar has loaded

Source: `lib/pokemon/filter.ts:73`, `lib/pokemon/filter.ts:82`, `lib/pokemon/filter.ts:90`, `lib/pokemon/filter.ts:110`, `lib/pokemon/filter.ts:118`, `lib/pokemon/filter.ts:124`, `lib/pokemon/filter.ts:132`.

### Requirement: Superuser locks the mastery filter (baseline)

With `pretendAllMastered` on, the effective mastery filter SHALL be `all` and the non-all chips SHALL
be disabled with an explanation, while the URL value stays as it was.

#### Scenario: URL asks for new species

- **WHEN** `mastery=new` is set and the flag is on
- **THEN** the grid is not filtered by mastery and the New chip is disabled

Source: `components/pokedex/PokedexFiltered.tsx:200`, `components/pokedex/PokedexFilterBar.tsx:213`, `components/pokedex/PokedexFiltered.test.tsx:402`.

### Requirement: Sort orders (baseline)

Sort SHALL be national, alphabetical or closest to mastery. Alphabetical SHALL use the active
language's name and collator, falling back to English, with the national number breaking ties.
Closest to mastery SHALL rank mastered, then learning by `reps` then `scheduledDays` descending, then
locked, by id within a tier. With `pretendAllMastered` it SHALL be id order. Closeness uses `reps`
although the mastery gate is stability; see Clarifications.

#### Scenario: Two learning species

- **WHEN** both are learning with different `reps`
- **THEN** the higher `reps` comes first

Source: `lib/pokedex/sort.ts:92`, `lib/pokedex/sort.ts:119`, `lib/pokedex/sort.ts:124`, `lib/pokedex/sort.ts:135`, `lib/pokedex/sort.ts:161`.

### Requirement: Sort choice is remembered (baseline)

A valid `sort` URL value SHALL win; an invalid one SHALL read as national. Without one, the stored
choice SHALL apply, and storage failure SHALL read as national. Choosing a sort SHALL store it and
write the URL, leaving out `national`.

#### Scenario: Back to the Pokédex

- **WHEN** the player chose alphabetical and returns to `/pokedex`
- **THEN** the grid is alphabetical with no `sort` in the URL

#### Scenario: Storage blocked

- **WHEN** reading storage throws
- **THEN** the sort is national and no error shows

Source: `components/pokedex/PokedexFiltered.tsx:58`, `components/pokedex/PokedexFiltered.tsx:72`, `components/pokedex/PokedexFiltered.tsx:100`, `components/pokedex/PokedexFiltered.tsx:188`, `lib/pokedex/sort.ts:59`, `components/pokedex/PokedexFiltered.test.tsx:578`.

### Requirement: Detail route resolves any seeded id (baseline)

`/pokedex/<id>` SHALL be pre-built for default forms and SHALL render any seeded id, alternate forms
included. A non-numeric or unknown id SHALL return not found. Metadata SHALL use the number only.
Alternate forms SHALL be passed in, leaving out the current entry and the default form.

#### Scenario: Unknown id

- **WHEN** the id is not in the seed
- **THEN** the page is a 404 and metadata falls back to the plain Pokédex title

#### Scenario: Alternate form page

- **WHEN** the id is 10100
- **THEN** that form renders, and it does not list itself

Source: `app/pokedex/[id]/page.tsx:23`, `app/pokedex/[id]/page.tsx:37`, `app/pokedex/[id]/page.tsx:43`, `app/pokedex/[id]/page.tsx:59`, `app/pokedex/[id]/page.tsx:68`.

### Requirement: Detail class is species mastery from the first matching card (baseline)

The detail page SHALL show a skeleton while pending. A species SHALL be `mastered` only when the first
matching name card and reverse card are both mastered; a mastered name with an unmastered reverse SHALL
read as `learning`. The lookup ignores language. `pretendAllMastered` SHALL force a resolved class to
mastered. This differs from the tile: #2296.

#### Scenario: One leg mastered

- **WHEN** the name card is mastered and the reverse card is not
- **THEN** the tile is mastered and the detail page is learning

#### Scenario: No session

- **WHEN** nothing is saved
- **THEN** the class is `locked`

Source: `lib/review/useCardClass.ts:19`, `lib/review/useCardClass.ts:29`, `lib/review/useCardClass.ts:49`, `components/pokedex/PokemonDetailDisclosure.tsx:330`, `components/pokedex/PokemonDetailDisclosure.tsx:408`.

### Requirement: Locked detail page reveals number and silhouette only (baseline)

A locked page SHALL show the number as its heading, a black sprite labelled by number, an unlock hint
and hint-only stats, facts and, for a multi-stage chain, evolution sections. It SHALL show no types,
audio, flavour text, forms or dates. The favourite controls stay, labelled by number.

#### Scenario: Locked species with an evolution chain

- **WHEN** a locked species has more than one stage
- **THEN** the Evolution Chain heading shows with only the hint

Source: `components/pokedex/PokemonDetailDisclosure.tsx:448`, `components/pokedex/PokemonDetailDisclosure.tsx:457`, `components/pokedex/PokemonDetailDisclosure.tsx:481`, `components/pokedex/PokemonDetailDisclosure.tsx:505`, `components/pokedex/PokemonDetailDisclosure.tsx:575`, `components/pokedex/PokemonDetailDisclosure.tsx:620`, `components/pokedex/PokemonDetailDisclosure.tsx:695`, `components/pokedex/PokemonDetailDisclosure.test.tsx:505`.

### Requirement: Tab title reveals the name only once unlocked (baseline)

The server title SHALL be number only. On the client, a non-locked species SHALL set the tab title to
its local name, and leaving SHALL restore the number title.

#### Scenario: Locked species

- **WHEN** a locked page loads
- **THEN** the tab keeps the number title

Source: `app/pokedex/[id]/page.tsx:38`, `components/pokedex/PokemonDetailDisclosure.tsx:398`, `components/pokedex/PokemonDetailDisclosure.tsx:404`.

### Requirement: Learning detail page (baseline)

A learning species SHALL show its local name, audio, types, the English flavour text, its next review
and any alternate forms, and SHALL NOT show stats, facts or the evolution chain. Next review SHALL
show unless pending, not started or `pretendAllMastered` is on.

#### Scenario: Due today

- **WHEN** the next review is today
- **THEN** the page says it is due today

Source: `components/pokedex/PokemonDetailDisclosure.tsx:476`, `components/pokedex/PokemonDetailDisclosure.tsx:510`, `components/pokedex/PokemonDetailDisclosure.tsx:580`, `components/pokedex/PokemonDetailDisclosure.tsx:620`, `components/pokedex/PokemonDetailDisclosure.tsx:709`, `components/pokedex/NextReviewDate.test.tsx:1`.

### Requirement: Mastered detail page (baseline)

A mastered species SHALL also show base stat bars out of 255 (green from 100, amber from 50, otherwise
red), facts, and the evolution chain when it has more than one stage. Chain nodes link to each stage
and show their own class: pending skeleton, `???` with a silhouette when locked. Chain sprites other
than the current one SHALL be preloaded only then. Node names and the hero alt are English in every
language: #2298.

#### Scenario: Chain node is locked

- **WHEN** a stage of a mastered species is locked
- **THEN** that node shows `???` and a silhouette, labelled by number

#### Scenario: Name language is Japanese

- **WHEN** a chain node is revealed
- **THEN** its text is the English `node.name`

Source: `components/pokedex/PokemonDetailDisclosure.tsx:147`, `components/pokedex/PokemonDetailDisclosure.tsx:164`, `components/pokedex/PokemonDetailDisclosure.tsx:209`, `components/pokedex/PokemonDetailDisclosure.tsx:214`, `components/pokedex/PokemonDetailDisclosure.tsx:390`, `components/pokedex/PokemonDetailDisclosure.tsx:424`, `components/pokedex/PokemonDetailDisclosure.tsx:585`, `components/pokedex/PokemonDetailDisclosure.tsx:667`, `components/pokedex/PokemonDetailDisclosure.test.tsx:515`.

### Requirement: Journey line and leg status (baseline)

A non-locked page SHALL show the earliest `firstSeen` across all languages' name cards, even during a
first learning step, a Mastered badge while mastered, and an approximate mastery month when the grade
log gives one. Leg status SHALL use the active language, and SHALL be hidden under
`pretendAllMastered`, with a note when blocked on one leg.

#### Scenario: Practised in English, viewed in Japanese

- **WHEN** only an `en` name card has `firstSeen`
- **THEN** the first-reviewed date still shows

#### Scenario: No crossing recoverable

- **WHEN** the species is mastered but no date can be derived
- **THEN** the badge shows with no date

Source: `components/pokedex/PokemonDetailDisclosure.tsx:78`, `components/pokedex/PokemonDetailDisclosure.tsx:97`, `components/pokedex/PokemonDetailDisclosure.tsx:355`, `components/pokedex/PokemonDetailDisclosure.tsx:535`, `components/pokedex/PokemonDetailDisclosure.tsx:559`, `components/pokedex/PokemonDetailDisclosure.tsx:566`.

### Requirement: Alternate form blocks (baseline)

A non-locked page SHALL list each alternate form as a collapsed block with thumbnail and name; opening
it shows a larger sprite, types and audio. Form names resolve through the species id, so in another
language every form shows the species name.

#### Scenario: Japanese with two forms

- **WHEN** the language is `ja`
- **THEN** both blocks read the species' Japanese name

Source: `components/pokedex/PokemonDetailDisclosure.tsx:237`, `components/pokedex/PokemonDetailDisclosure.tsx:243`, `components/pokedex/PokemonDetailDisclosure.tsx:709`, `lib/pokemon/seed-builder.ts:54`, `lib/i18n/useLocalePokemonName.ts:69`.

### Requirement: Facts are derived from seed fields (baseline)

Facts SHALL be listed only for non-null fields, in fixed order, with friendly tiers and comparisons,
then the strongest stat, status, and one row per flavour entry labelled by its games or `Pokédex
entry`. Flavour text SHALL load once in the background, and a failed load SHALL show facts without
entries. Fact text is English: #2298.

#### Scenario: Cold first visit

- **WHEN** the flavour file has not loaded
- **THEN** facts render, and the entries join after the load

#### Scenario: Flavour fetch fails

- **WHEN** the fetch errors
- **THEN** the page shows no error and no entries

Source: `lib/pokemon/facts.ts:32`, `lib/pokemon/facts.ts:45`, `lib/pokemon/facts.ts:161`, `lib/pokemon/facts.ts:210`, `lib/pokemon/facts.ts:228`, `lib/pokemon/flavorTextAccumulator.ts:61`, `components/pokedex/PokemonDetailDisclosure.tsx:376`.

### Requirement: Cry playback (baseline)

The shared player SHALL use one audio element at volume 0.6, replacing any cry in progress and dropping
its callback. `onEnded` SHALL fire on the end, at once with nothing to play, or when `play()` is
rejected other than by an interruption. `awaitCryEnd` SHALL resolve at most 5 seconds later. The
Pokédex cry button SHALL not render without a URL.

#### Scenario: Second cry during the first

- **WHEN** a new cry starts mid-play
- **THEN** the first callback never fires

#### Scenario: Autoplay blocked

- **WHEN** `play()` rejects with `NotAllowedError`
- **THEN** `onEnded` still fires and nothing is logged

Source: `lib/audio/cry.ts:15`, `lib/audio/cry.ts:32`, `lib/audio/cry.ts:51`, `lib/audio/cry.ts:58`, `lib/audio/cry.ts:80`, `components/pokedex/CryButton.tsx:14`, `lib/audio/cry.test.ts:1`.

### Requirement: Spoken names (baseline)

With an id, `en` language and `Audio` available, `speakName` SHALL play `/audio/names/<id>.mp3` at the
saved rate and volume, falling back once to Web Speech on error. Otherwise it SHALL use Web Speech.
English speech SHALL apply phonetic overrides and strip gender symbols. Other languages SHALL speak
the name as written with a voice matching the language; a pinned voice applies to English only.
Blocked storage SHALL fall back to defaults.

#### Scenario: Missing MP3

- **WHEN** the file 404s, firing both `error` and a rejected `play()`
- **THEN** speech runs once

#### Scenario: Japanese name

- **WHEN** the active language is `ja`
- **THEN** no MP3 is requested and the utterance is tagged `ja`

Source: `lib/audio/tts.ts:197`, `lib/audio/tts.ts:220`, `lib/audio/tts.ts:232`, `lib/audio/tts.ts:251`, `lib/audio/tts.ts:283`, `lib/audio/tts.ts:302`, `lib/audio/tts.ts:311`, `lib/audio/pronunciations.ts:229`, `lib/audio/tts.test.ts:1`.

### Requirement: Voice choice and warm-up (baseline)

Auto-picked English voices SHALL prefer en-GB over tier, then premium over enhanced over compact, then
local over network. `warmupTts` SHALL fire once per session inside a user gesture.

#### Scenario: Premium US against compact GB

- **WHEN** both are installed
- **THEN** the compact en-GB voice is chosen

Source: `lib/audio/tts.ts:33`, `lib/audio/tts.ts:47`, `lib/audio/tts.ts:67`, `lib/audio/tts.ts:90`.

### Requirement: Waiting for audio (baseline)

`waitForAudio` SHALL wait for the cry, yield one macrotask, then wait for speech, so a chained cry and
name finish in order. Each leg SHALL give up after 5 seconds, for at most 10.

#### Scenario: Cry then name

- **WHEN** a cry's end starts speech
- **THEN** the wait ends after the speech

Source: `lib/audio/waitForAudio.ts:30`, `lib/audio/tts.ts:138`, `lib/audio/tts.ts:159`.

### Requirement: Who is in the Pasture (baseline)

The Pasture SHALL show one entry per name card in the active language whose name and paired reverse
cards, also in that language, are both mastered. Cards without a language SHALL count as `en`. Alternate
form cards qualify in the same way.

#### Scenario: One leg mastered

- **WHEN** the reverse card is below the gate
- **THEN** the species is not in the Pasture

#### Scenario: Language switched

- **WHEN** the name language changes and settings are saved
- **THEN** the Pasture re-derives for that language with no reload

Source: `lib/pasture/arrivals.ts:63`, `lib/pasture/arrivals.ts:72`, `lib/pasture/arrivals.ts:84`, `app/pasture/page.tsx:173`, `app/pasture/page.tsx:320`, `lib/pasture/arrivals.test.ts:1`.

### Requirement: Pasture page load and empty state (baseline)

The page SHALL render nothing until loaded. It SHALL hydrate saved cards with every card type disabled,
so nothing is added, and SHALL save only if a card was healed. With nothing mastered it SHALL show the
title, an explanation, the press-and-hold hint and Next arrivals, with no search bar.

#### Scenario: First visit with no mastery

- **WHEN** the player has mastered nothing
- **THEN** the empty message and the arrivals strip show

#### Scenario: Storage key changes

- **WHEN** a sync pull or reset changes the session
- **THEN** the page reloads it without navigation

Source: `app/pasture/page.tsx:168`, `app/pasture/page.tsx:197`, `app/pasture/page.tsx:211`, `app/pasture/page.tsx:301`, `app/pasture/page.tsx:338`.

### Requirement: Pasture link visibility (baseline)

Pasture nav entries SHALL show when `KEY_HAS_MASTERED` is `"true"`, when a full check finds mastery, or
when `pretendAllMastered` is on. Writes made before hydration SHALL be caught up. The full check counts
`en` only, which looks wrong: #2293.

#### Scenario: Japanese mastery on a new device

- **WHEN** the flag is absent and all mastery is in `ja`
- **THEN** the link stays hidden, and the page still opens by URL

#### Scenario: Flag present

- **WHEN** the flag is `"true"`
- **THEN** the link shows without loading the session

Source: `lib/pasture/usePastureMasteryState.ts:80`, `lib/pasture/usePastureMasteryState.ts:88`, `lib/pasture/usePastureMasteryState.ts:96`, `lib/pasture/usePastureMasteryState.ts:103`, `components/review/ReviewSession.tsx:287`, `components/usePastureMasteryState.test.tsx:128`.

### Requirement: Pasture search and filters (baseline)

Pasture filters SHALL be held in page state, not the URL: name search, types (AND) and generation. In
another language search SHALL also match the local name and transliteration; alternate form names are
not searched. Stats SHALL ignore these filters. Filters SHALL reset when mastery falls to none. A
filtered empty result SHALL show a message.

#### Scenario: Filter hides every zone

- **WHEN** no mastered species matches
- **THEN** the page shows the no-match message and the arrivals strip

#### Scenario: Stats under a filter

- **WHEN** a type filter is active
- **THEN** biome percentages still use all mastered cards

Source: `app/pasture/page.tsx:109`, `app/pasture/page.tsx:164`, `app/pasture/page.tsx:245`, `app/pasture/page.tsx:390`, `app/pasture/page.tsx:95`, `components/pasture/PastureSearchBar.tsx:57`.

### Requirement: Habitats and zones (baseline)

Species SHALL be grouped by habitat in fixed zone order, with a null habitat in Wildlands, and empty
zones omitted. Each of the ten zones SHALL have its own illustration, tint fallback and translated
label, and a link to its biome view. Zone slots are fractional coordinates kept within 0.03 to 0.97.

#### Scenario: Null habitat

- **WHEN** a mastered species has no habitat
- **THEN** it appears in Wildlands

Source: `app/pasture/page.tsx:67`, `app/pasture/page.tsx:78`, `lib/pasture/zones.ts:45`, `lib/pasture/zones.ts:65`, `lib/pasture/zones.ts:78`, `components/pasture/PastureZone.tsx:27`, `components/pasture/PastureZone.tsx:116`, `components/pasture/PastureZone.tsx:132`, `components/pasture/biomes/BiomeSvg.tsx:18`.

### Requirement: Sprite placement (baseline)

Sprites SHALL be placed in order of `firstSeen` (nulls last) then id, through sub-regions in order,
wrapping past the last slot so sprites may overlap. Sprites SHALL paint back to front and scale from
0.65 to 1.15 across y 0.55 to 0.97. The favourite's own spot is set by #2187.

#### Scenario: More species than slots

- **WHEN** Wildlands has more than 240 mastered species
- **THEN** later sprites reuse slots from the start

Source: `lib/pasture/assign.ts:40`, `lib/pasture/assign.ts:67`, `lib/pasture/assign.ts:78`, `components/pasture/PastureZone.tsx:176`, `components/pasture/PastureZone.tsx:184`, `lib/pasture/assign.test.ts:1`.

### Requirement: Biome statistics (baseline)

A zone SHALL show mastered over total default forms in its habitat, a rounded percentage, and the
latest addition in the active language. Alternate forms SHALL not count, though the zone heading count
includes them. Latest addition SHALL use the newest `firstSeen`, not the mastery date. With
`pretendAllMastered`, mastered SHALL equal total at 100%. Before the seed loads totals are 0.

#### Scenario: Alternate form mastered

- **WHEN** Alolan Raichu is mastered
- **THEN** the heading count rises and the stats do not

Source: `lib/pasture/stats.ts:15`, `lib/pasture/stats.ts:67`, `lib/pasture/stats.ts:91`, `lib/pasture/stats.ts:111`, `components/pasture/PastureBiomeStats.tsx:36`, `components/pasture/PastureZone.tsx:129`.

### Requirement: Tapping and holding a sprite (baseline)

A tap SHALL play the cry, hop for 600 ms and clear a new-arrival sparkle. Pressing for 500 ms SHALL open
a popover with name, first seen and interval, and SHALL NOT also count as a tap. Escape, an outside
press or Close SHALL dismiss it, and tapping the sprite SHALL dismiss it and still play. The popover
opens by pointer only. The cry uses its own `Audio` at full volume, falling back to `/cries/<id>.ogg`.
Dates use `dmy-year` in UTC, not the player's date setting.

#### Scenario: Long press

- **WHEN** the player holds for 500 ms and releases
- **THEN** the popover opens with no cry or hop

#### Scenario: Keyboard

- **WHEN** a keyboard player activates a sprite
- **THEN** it behaves as a tap and no popover opens

Source: `components/pasture/PasturePokemon.tsx:20`, `components/pasture/PasturePokemon.tsx:62`, `components/pasture/PasturePokemon.tsx:82`, `components/pasture/PasturePokemon.tsx:105`, `components/pasture/PasturePokemon.tsx:128`, `components/pasture/PasturePokemon.tsx:138`, `components/pasture/PasturePokemon.tsx:161`, `components/pasture/PasturePokemon.test.tsx:1`.

### Requirement: New arrivals are acknowledged once (baseline)

An unseen mastered sprite SHALL sparkle and add a new-arrival suffix to its label. Tapping it on the
main Pasture SHALL save `seenInPasture` and push the card, with a failed push only logged, and no push
while any superuser flag is on. Marking matches every card with that id, in every language, and pushes
the first match, which looks wrong: #2295.

#### Scenario: Cards in two languages

- **WHEN** a species has `en` and `ja` cards and `ja` is active
- **THEN** both are marked seen and the first in the array is pushed

#### Scenario: Superuser flag on

- **WHEN** any flag is on
- **THEN** the mark is saved locally and nothing is pushed

Source: `lib/pasture/arrivals.ts:96`, `app/pasture/page.tsx:271`, `app/pasture/page.tsx:286`, `app/pasture/page.tsx:288`, `components/pasture/PasturePokemon.tsx:100`, `components/pasture/PasturePokemon.tsx:178`, `components/pasture/PasturePokemon.tsx:194`.

### Requirement: Next arrivals (baseline)

The strip SHALL show up to five name cards in the active language, seen at least once, by `reps`
descending then earliest due date. It SHALL leave out a species with either leg mastered, including
one that is one leg from the Pasture, which looks wrong: #2292. An empty list SHALL show the
all-caught-up line, including with `pretendAllMastered` on or nothing reviewed.

#### Scenario: Name mastered, reverse not

- **WHEN** only the name card is mastered
- **THEN** the species is in neither the Pasture nor the strip

#### Scenario: Nothing reviewed

- **WHEN** a new player opens the Pasture
- **THEN** the strip says every reviewed Pokémon is already there

Source: `lib/pasture/nextArrivals.ts:53`, `lib/pasture/nextArrivals.ts:60`, `lib/pasture/nextArrivals.ts:81`, `lib/pasture/nextArrivals.ts:84`, `lib/pasture/nextArrivals.ts:88`, `lib/pasture/nextArrivals.ts:100`, `lib/pasture/nextArrivals.test.ts:128`, `lib/pasture/nextArrivals.test.ts:133`, `components/pasture/NextArrivalsStrip.tsx:94`.

### Requirement: Biome view (baseline)

`/pasture/<habitat>` SHALL show one zone with stats and a back button, return not found for an unknown
habitat, and render nothing while loading. In portrait it SHALL rotate 90 degrees, and in landscape
not at all, following rotation live. Back SHALL go to `/pasture` when there is no history. Tapping an
arrival here SHALL not clear its sparkle. The heading uses the English zone label: #2298.

#### Scenario: Direct link

- **WHEN** the page was opened with no history and back is pressed
- **THEN** the player lands on `/pasture`

#### Scenario: Device rotates

- **WHEN** portrait turns to landscape
- **THEN** the rotation is removed without a reload

#### Scenario: Superuser flag on

- **WHEN** `pretendAllMastered` is on
- **THEN** cards come from the seed and do not sparkle

Source: `app/pasture/[biome]/page.tsx:36`, `app/pasture/[biome]/page.tsx:125`, `app/pasture/[biome]/page.tsx:139`, `app/pasture/[biome]/page.tsx:189`, `app/pasture/[biome]/page.tsx:238`, `app/pasture/[biome]/page.tsx:266`, `app/pasture/[biome]/page.tsx:292`, `app/pasture/[biome]/page.tsx:337`.

### Requirement: Superuser pretendAllMastered on the Pasture (baseline)

With `pretendAllMastered` on, every seed entry SHALL appear, alternate forms included, built in memory
and marked seen, with nothing persisted. Next arrivals SHALL be empty.

#### Scenario: Fresh device

- **WHEN** the flag is on and nothing is saved
- **THEN** the Pasture is full and the saved session is unchanged

Source: `app/pasture/page.tsx:312`, `app/pasture/page.tsx:317`, `app/pasture/page.tsx:332`, `lib/pasture/nextArrivals.ts:60`.

### Requirement: Idle motion (baseline)

Sprites SHALL bob in CSS, wander and jump on one animation frame loop at about 8 updates a second,
pausing when off-screen or when the tab is hidden, without React renders. Wander stays within a band
from the sub-region's slots. The transform uses percentages of the sprite's own box, so travel is
under one sprite width, which looks unintended: #2300. Motion SHALL not run when the screenshot freeze
flag is set.

#### Scenario: Zone scrolls away

- **WHEN** a zone leaves the viewport
- **THEN** its sprites stop updating until it returns

#### Scenario: Throttle

- **WHEN** a tick arrives under 120 ms after the last
- **THEN** `changed` is false and the DOM is not written

Source: `lib/pasture/behavior.ts:15`, `lib/pasture/behavior.ts:107`, `lib/pasture/behavior.ts:148`, `lib/pasture/behavior.ts:196`, `components/pasture/useIdleBehaviour.ts:56`, `components/pasture/useIdleBehaviour.ts:117`, `components/pasture/useIdleBehaviour.ts:159`, `components/pasture/useIdleBehaviour.ts:168`, `components/pasture/useIdleBehaviour.ts:211`, `lib/pasture/behavior.test.ts:1`.

### Requirement: Reduced motion on the Pasture (baseline)

With Reduce Motion on, the CSS bob SHALL stop, and the idle loop SHALL not start. Turning it on during a
visit SHALL stop the loop and clear transforms. The tap hop and looping sparkle keep animating, and
turning it off after mounting with it on does not resume the loop: #2299.

#### Scenario: Preference on at load

- **WHEN** Reduce Motion is on as a zone mounts
- **THEN** there is no bob, wander or jump, and an unseen sparkle still twinkles

Source: `components/pasture/Pasture.module.css:49`, `components/pasture/Pasture.module.css:53`, `components/pasture/Pasture.module.css:96`, `components/pasture/useIdleBehaviour.ts:128`, `components/pasture/useIdleBehaviour.ts:175`.

### Requirement: Seed loading (baseline)

Seed data SHALL be fetched at runtime, with one shared request, cached on success. A failure SHALL
reject with a description, clear the in-flight state so a retry can run, and surface through
`SeedProvider` as `error` with `retry()`. Sidecars for names and flavour SHALL fail softly to empty.

#### Scenario: Offline first load

- **WHEN** the fetch fails
- **THEN** `error` is set, `seed` stays null and `retry()` tries again

#### Scenario: Locale sidecar fails

- **WHEN** the names file errors
- **THEN** English names are used and no error shows

Source: `lib/pokemon/seed-async.ts:38`, `lib/pokemon/seed-async.ts:50`, `lib/pokemon/SeedContext.tsx:69`, `lib/pokemon/SeedContext.tsx:91`, `lib/pokemon/localeNames.ts:42`, `lib/pokemon/seed-async.test.ts:1`, `components/pokemon/SeedContext.test.tsx:1`.

### Requirement: Seed building and card ids (baseline)

`buildSeed` SHALL join core records to deduplicated chains, leave `flavorTexts` undefined, and derive one
evolution card per forward edge plus a reverse for each. Alternate-form ids SHALL be skipped as
pre-evolutions. A missing `edgeId`, an out-of-range edge or an unknown post-evolution SHALL throw. Id
ranges for name, edge, reverse, reverse-edge and cry cards SHALL stay disjoint, and species ids are
1 to 1025.

#### Scenario: Edge with no id

- **WHEN** a chain edge lacks `edgeId`
- **THEN** building throws and says to re-run the seed

Source: `lib/pokemon/seed-builder.ts:272`, `lib/pokemon/seed-builder.ts:299`, `lib/pokemon/seed-builder.ts:310`, `lib/pokemon/seed-builder.ts:315`, `lib/pokemon/seed-builder.ts:322`, `lib/pokemon/seed-builder.ts:349`, `lib/pokemon/seed-constants.ts:23`, `lib/pokemon/seed-constants.ts:45`, `lib/pokemon/seed.test.ts:1`.

### Requirement: Which forms are seeded (baseline)

The pipeline SHALL drop stub entries, battle-only forms, totems, Minior meteors and ride modes, and keep
other alternate forms with a category of regional, forme and so on. A regional evolution edge SHALL gain
a form-aware node when the child has that variant, with parent falling back to the default.

#### Scenario: Mega form

- **WHEN** a form is `is_battle_only`
- **THEN** it is not worth learning

#### Scenario: No such regional child

- **WHEN** an edge names a region the child lacks
- **THEN** no extra node is added

Source: `lib/pokemon/forms.ts:40`, `lib/pokemon/forms.ts:58`, `lib/pokemon/forms.ts:110`, `lib/pokemon/chainExpansion.ts:114`, `lib/pokemon/chainExpansion.ts:145`, `lib/pokemon/chainExpansion.ts:151`, `lib/pokemon/forms.test.ts:1`, `lib/pokemon/chainExpansion.test.ts:1`.

### Requirement: Evolution trigger phrases (baseline)

Each edge SHALL get a phrase from its details, or null for an unknown shape. A fixed list of colliding
edges SHALL gain a disambiguating clause. Wurmple's branches stay ambiguous on purpose, with either
answer accepted.

#### Scenario: Cosmoem to Solgaleo

- **WHEN** the edge is 790 to 791
- **THEN** the phrase gains `in Pokémon Sun / Ultra Sun`

Source: `lib/pokemon/triggers.ts:157`, `lib/pokemon/disambiguateTrigger.ts:21`, `lib/pokemon/disambiguateTrigger.ts:37`, `lib/pokemon/disambiguateTrigger.ts:51`, `lib/pokemon/collisionScan.test.ts:1`.

### Requirement: Evolution families (baseline)

Families SHALL be one per distinct chain of default forms, with solo species and chains with no edges
left out. An edge is fully mastered when forward and reverse are, in any language, and a family
complete when all edges are. Order SHALL be in progress, untouched, complete, then root id.
`pretendAllMastered` SHALL complete all of them, which empties the incomplete-chains set.

#### Scenario: One direction mastered

- **WHEN** one forward card is mastered
- **THEN** the family is in progress and its species join the incomplete set

Source: `lib/evolution/chains.ts:92`, `lib/evolution/chains.ts:113`, `lib/evolution/chains.ts:139`, `lib/evolution/chains.ts:182`, `lib/evolution/chains.ts:195`, `lib/evolution/chains.ts:230`, `lib/evolution/chains.ts:253`, `lib/evolution/chains.test.ts:1`.

### Requirement: Pure species helpers (baseline)

`pickDailySpecies` and `pickDailyFact` SHALL pick by hash of the day, default forms only, or null with
nothing to pick. `pickDistractors` SHALL be stable for a target and seed, leave out the target and
return all candidates when short. `STARTER_IDS` SHALL list the 27 starters. `formatVersions` SHALL sort
games by release order.

#### Scenario: Same day

- **WHEN** two sessions share a date string
- **THEN** they get the same species and fact

#### Scenario: Small pool

- **WHEN** fewer candidates exist than requested
- **THEN** all are returned with no error

Source: `lib/pokemon/dailySpotlight.ts:25`, `lib/pokemon/dailySpotlight.ts:44`, `lib/pokemon/distractors.ts:14`, `lib/pokemon/starterIds.ts:12`, `lib/pokemon/versionNames.ts:109`, `lib/pokemon/dailySpotlight.test.ts:1`, `lib/pokemon/distractors.test.ts:1`.

### Requirement: Sprite URLs and sizes (baseline)

`next/image` sprite paths SHALL be rewritten to pre-generated WebP at the smallest width not below the
request, capped at the largest, so no image optimiser runs. Other sources SHALL pass unchanged. The grid
SHALL use a plain lazy image with 1x, 2x and 3x sources at 64, 120 and 192 px.

#### Scenario: Width between sizes

- **WHEN** width 100 is requested
- **THEN** the 120 WebP is returned

#### Scenario: Avatar URL

- **WHEN** the source is a GitHub avatar
- **THEN** it is returned unchanged

Source: `lib/sprites/imageLoader.ts:48`, `lib/sprites/imageLoaderHelpers.ts:36`, `lib/sprites/imageLoaderHelpers.ts:64`, `lib/sprites/url.ts:27`, `lib/sprites/url.ts:50`, `lib/sprites/sizes.ts:21`, `components/pokedex/PokedexGrid.tsx:133`, `lib/sprites/imageLoader.test.ts:1`.

### Requirement: Sprite preload and decode (baseline)

`SpritePreloader` SHALL render a hidden 1 px box of eager images, deduplicated by width and URL and
skipping empty URLs. `decodeSpriteUrls` SHALL resolve when all decode or after the timeout (500 ms, or
150 ms on the grade path), ignoring per-image failures, and SHALL call `onSlowLoad` only on a timeout.

#### Scenario: Slow sprite

- **WHEN** a decode takes longer than the timeout
- **THEN** the caller proceeds and `onSlowLoad` fires

#### Scenario: Empty URL

- **WHEN** a list holds an empty string
- **THEN** it is skipped, with no crash

Source: `components/sprites/SpritePreloader.tsx:51`, `components/sprites/SpritePreloader.tsx:59`, `lib/sprites/decode.ts:7`, `lib/sprites/decode.ts:14`, `lib/sprites/decode.ts:51`, `lib/sprites/decode.ts:65`, `lib/sprites/useSpritePrefetch.ts:26`, `components/sprites/decode.test.tsx:1`.

### Requirement: Higher or Lower rules (baseline)

`pickPair` SHALL choose two different entries and a random base stat, and SHALL throw with fewer than
two. `shufflePair` SHALL swap sides half the time. A guess SHALL be correct when it names the higher
value, and every tie SHALL be correct. The pool SHALL be species with any seen card, deduplicated, and
eligible for the practice scope and alternate-forms setting.

#### Scenario: Tie

- **WHEN** both stats are equal
- **THEN** either guess scores correct with `tie` true

#### Scenario: One seen species

- **WHEN** the pool has one entry
- **THEN** `pickPair` throws

Source: `lib/minigame/higherOrLower.ts:37`, `lib/minigame/higherOrLower.ts:65`, `lib/minigame/higherOrLower.ts:79`, `lib/minigame/higherOrLower.ts:122`, `lib/minigame/higherOrLower.test.ts:1`.

## Clarifications

2 November 2026 (written unattended, no owner answers yet; each is an open call with a recommendation).

- Should a spec describe a bug as a requirement? Yes for a baseline: it says what is true today and names the issue. Recommendation: the fix's delta modifies that requirement.
- Should closeness use `reps` when the gate is stability (`lib/pokedex/sort.ts:135`, `lib/pasture/nextArrivals.ts:101`)? Recorded as it is. Recommendation: settle it inside #2292.
- Should the sprite press-and-hold popover have a keyboard route? It has none (`components/pasture/PasturePokemon.tsx:175`). Recommendation: add one when the Pasture next changes; no issue filed, as it is a gap rather than a fault.
- Hint copy says "mastery date", the popover shows first seen (`messages/en.json:797`, `components/pasture/PasturePokemon.tsx:209`). Recommendation: change the copy.
- Pasture cries skip the shared player, so they play at full volume and can overlap (`components/pasture/PasturePokemon.tsx:62`). Recommendation: route them through `playCry` with the next audio change.
- Should alternate forms keep sharing the species name in other languages? `lib/pokemon/seed-builder.ts:54` says so. Recommendation: keep, unless translators ask.
- A stale-closure reading of `handleQueryChange` was tested and is not a bug: `filters.types` is a new array each render, so the callback refreshes.
