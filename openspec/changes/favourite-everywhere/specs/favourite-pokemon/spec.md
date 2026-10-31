## Purpose

The player's favourite Pokémon and the app theme. A favourite can be any species, with an open list of hearted species; it appears as the player's partner across the app. The theme (the colours on screen) comes from a mastered species, the favourite's once it is mastered. Requirements marked "(baseline, current behaviour)" describe the theme as it is on `qa` before change favourite-everywhere (#2187) and stay true; the rest are new or replace the baseline rules noted in their titles.

## ADDED Requirements

### Requirement: Locked state when nothing is unlocked (baseline, current behaviour)

When no species is mastered, the appearance section SHALL show the locked heading, the
"Master your first Pokémon to unlock themes." body and a practice link to `/`, and SHALL NOT render
any "Set as theme" button.

#### Scenario: Nothing mastered

- **WHEN** a player with no mastered species opens Settings
- **THEN** the locked message and a link to `/` show, and no "Set as theme" button exists

<!-- source: app/settings/page.tsx:218-238; app/settings/page.test.tsx:1253-1278 -->

### Requirement: Intensity controls how far the palette spreads, and the watermark (baseline, current behaviour)

`settings.themeIntensity` SHALL be one of `accents` (default), `tinted` or `full`; any other stored
value SHALL fall back to `accents`. At `accents` no `data-intensity` attribute SHALL be set; at
`tinted` or `full` `<html>` SHALL carry `data-intensity` with that value, and the CSS SHALL tint the
background and surfaces (`full` also uses `--theme-fg-on-primary` as the foreground in light mode).

#### Scenario: Tinted intensity

- **WHEN** intensity is `tinted`
- **THEN** `<html>` carries `data-intensity="tinted"`


### Requirement: The watermark follows intensity (baseline, current behaviour)

At `tinted` or `full` a fixed, decorative watermark SHALL show the theme's sprite at
`THEME_WATERMARK_SPRITE_SIZE`, or a Poké Ball outline when there is no sprite or no theme. At
`accents` there SHALL be no watermark. Intensity works whether or not a theme is set, using the
default red palette when none is.

#### Scenario: Accents

- **WHEN** intensity is `accents`
- **THEN** no watermark renders

#### Scenario: Tinted with a theme

- **WHEN** intensity is `tinted` and the theme has a sprite
- **THEN** `data-intensity="tinted"` is on `<html>` and the watermark shows that sprite

#### Scenario: Tinted without a sprite

- **WHEN** intensity is `tinted` and the theme has no sprite URL
- **THEN** the watermark shows the Poké Ball outline

<!-- source: lib/theme/intensity.ts:12-20; components/theme/intensity.test.tsx:14-36; lib/settings/persistence.ts:791-796; app/globals.css:65-98; components/theme/ThemeWatermark.tsx:23-84; components/theme/ThemeWatermark.test.tsx:43-80; e2e/theming.spec.ts:27-270 -->

### Requirement: Clearing the theme restores the default palette (baseline, current behaviour)

Remove on the current theme SHALL save `favouriteTheme: null` and remove the four `--theme-*` inline
styles from `<html>`, so the `:root` defaults in `globals.css` (Poké Ball red `#E01B2E`, `#FF9DA6`,
`#C2162A`, white) apply again. The mascot SHALL disappear and the watermark, if shown, SHALL fall back
to the Poké Ball. Intensity SHALL be left unchanged.

#### Scenario: Remove the current theme

- **WHEN** the player taps Remove on the current theme
- **THEN** `settings.favouriteTheme` is null and `<html>` has no inline `--theme-*` properties

<!-- source: app/settings/page.tsx:285-293, 1797-1804; lib/theme/persistence.ts:175-179; lib/theme/apply.ts:6-10; lib/theme/apply.test.ts:53-66; lib/theme/persistence.test.ts:128-140; app/globals.css:25-28 -->

### Requirement: The theme is stored in the settings blob, with a one-time legacy migration (baseline, current behaviour)

The canonical store SHALL be `favouriteTheme` inside `poke-memory:settings:v1`. When that field is
missing or invalid and the legacy key `poke-memory:favourite:v1` exists, `loadFavourite` SHALL
validate the legacy value, copy it into settings when valid, and SHALL remove the legacy key whether
or not it was valid. Load and save failures (private browsing, full storage) SHALL be swallowed:
load returns null, save does nothing. On the server both SHALL be no-ops.

#### Scenario: Legacy value present

- **WHEN** only `poke-memory:favourite:v1` holds a valid theme
- **THEN** `loadFavourite` returns it, `settings.favouriteTheme` now holds it, and the legacy key is gone

#### Scenario: Corrupt legacy value

- **WHEN** the legacy key holds an invalid value
- **THEN** `loadFavourite` returns null and the legacy key is removed

<!-- source: lib/theme/persistence.ts:14-19, 88-126, 168-183; lib/storage/keys.ts:32, 96-98; lib/theme/persistence.test.ts:54-81, 104-140 -->

### Requirement: The theme is painted before first render (baseline, current behaviour)

An inline script in `<head>` SHALL read `poke-memory:settings:v1` before hydration and set each
`--theme-*` variable whose stored colour passes the same hex pattern, and SHALL set `data-intensity`
when the stored intensity is `tinted` or `full`, so there is no flash of the default palette. After
mount the provider SHALL re-apply intensity at once, then load the validated theme and apply its
colours (or remove them when there is none). Errors in the script SHALL be ignored.

#### Scenario: Reload with a saved theme

- **WHEN** a player with Gengar saved reloads any page
- **THEN** Gengar's colours are on `<html>` before React hydrates

<!-- source: app/layout.tsx:110-117, 181-182; components/theme/FavouriteThemeProvider.tsx:55-66; e2e/theming.spec.ts:40-77 -->

### Requirement: Changes in other tabs and in the same tab are picked up (baseline, current behaviour)

The provider SHALL re-load and re-apply the theme and intensity on a `storage` event for
`poke-memory:settings:v1` or the legacy key (other tabs), and on `poke-memory:settings-saved` (same
tab, fired by every `saveSettings`). The watermark SHALL follow intensity through the event detail
and an observer on `data-intensity`.

#### Scenario: Cloud pull writes a new theme

- **WHEN** a sync pull saves settings with a different `favouriteTheme`
- **THEN** the settings-saved event fires and the new palette is applied without a reload

<!-- source: components/theme/FavouriteThemeProvider.tsx:68-97; lib/settings/persistence.ts:1103-1124; components/theme/ThemeWatermark.tsx:32-61 -->

### Requirement: Signed-in players sync the theme as a settings key; guests keep it local (baseline, current behaviour)

For a signed-in player with no superuser flag on, every settings save SHALL push the top-level keys
that differ from the last pushed snapshot, so a changed `favouriteTheme` (including null) is sent as
one whole value. On a device's first push, a `favouriteTheme` equal to the default (null) SHALL be
left out so it cannot overwrite a cloud value.

#### Scenario: Fresh device first push

- **WHEN** a fresh device with `favouriteTheme: null` pushes for the first time
- **THEN** `favouriteTheme` is not in the patch

<!-- source: components/sync/AutoSyncOnChange.tsx:43-80; lib/settings/lastPushedSnapshot.ts:60-108; lib/sync/pullAndMerge.ts:195-252; lib/settings/persistence.ts:31-40 -->

### Requirement: Pulled settings replace local settings (baseline, current behaviour)

On pull, the cloud blob SHALL replace local settings,
`favouriteTheme` included, when the device has no settings yet or the cloud row is newer than the
last applied pull. Settings push and pull are best-effort. Guests SHALL keep the theme in
localStorage only.

#### Scenario: Newer cloud row

- **WHEN** the cloud settings row is newer than the last applied pull
- **THEN** the cloud `favouriteTheme` replaces the local one

#### Scenario: Pick on device A, open device B

- **WHEN** a signed-in player picks Pikachu on device A and device B later pulls
- **THEN** device B's settings hold Pikachu and its palette is applied

### Requirement: Any species can be the favourite

The player SHALL have at most one favourite, stored as `favouritePokemonId` (a species id from the
seed, or null) in the settings blob, separate from the theme (`favouriteTheme`). Any of the 1025
species SHALL be eligible, mastered or not. It SHALL be set from a "Make favourite" button on every
Pokédex detail page (silhouettes included) or from a search over all species in Settings, which
matches names in the active learning locale. Setting a favourite SHALL also heart it.

#### Scenario: Favourite before learning it

- **WHEN** a new player opens Bulbasaur's (silhouette) detail page and taps "Make favourite"
- **THEN** `favouritePokemonId` is 1, Bulbasaur is hearted, and the colours on screen do not change

#### Scenario: Unlearned species in the search

- **WHEN** the player searches "gengar" in Settings and Gengar is not mastered (and `pretendAllMastered` is off)
- **THEN** Gengar's row shows its silhouette with its name, while mastered species show their full sprite

#### Scenario: Search in Japanese

- **WHEN** the active learning locale is `ja` and the player types "ゲンガー" in the Settings favourite search
- **THEN** Gengar is offered and can be made the favourite

#### Scenario: Change of favourite

- **WHEN** Gengar is the favourite and the player makes Eevee the favourite
- **THEN** `favouritePokemonId` is 133 and Gengar stays hearted

### Requirement: Clearing the favourite

The player
SHALL be able to clear the favourite from either place; clearing it SHALL NOT change the theme or the
hearts.

#### Scenario: Clear

- **WHEN** the player clears their favourite in Settings
- **THEN** `favouritePokemonId` is null and the theme and hearts are unchanged

### Requirement: Hearts make an open shortlist

`heartedSpeciesIds` SHALL be an array of species ids, newest first, with no repeats, synced as one
value. A heart toggle on every Pokédex detail page SHALL add or remove the species, and the Pokédex
grid SHALL show a small heart on hearted species. The current favourite SHALL always be hearted: its
heart toggle SHALL show as on and SHALL NOT remove it while it is the favourite.

#### Scenario: Heart and un-heart

- **WHEN** the player hearts Snorlax and later taps the heart again
- **THEN** Snorlax is added at the front of `heartedSpeciesIds`, shows a heart in the grid, and is then removed

#### Scenario: The favourite's heart

- **WHEN** the player taps the heart on their favourite's detail page
- **THEN** it stays hearted and the button's label says it is their favourite

#### Scenario: Screen reader

- **WHEN** a screen reader reaches the heart or "Make favourite" button
- **THEN** it is announced as a toggle (`aria-pressed`) with a localised label naming the species

#### Scenario: Two devices

- **WHEN** a signed-in player hearts Mew on device A and un-hearts Pikachu on device B after B has pulled
- **THEN** after both sync, both devices hold the last-written whole list, as for any other array setting

### Requirement: Every species has a contrast-checked palette

Every species SHALL have a palette of four colours (`primary`, `secondary`, `accent`, `fgOnPrimary`),
chosen in this order: its `CURATED_POKEMON` entry; else the palette extracted from its sprite by
`npm run seed:palettes` when it passes the checks; else the hand-tuned palette for its primary type
(18 type palettes).

#### Scenario: Extraction fails the check

- **WHEN** none of a sprite's candidate primaries (three hues, each with its lightness steps) passes the checks
- **THEN** that species uses its primary type's palette

#### Scenario: Coverage test

- **WHEN** the unit tests run
- **THEN** they fail if any seed species lacks a palette or any palette fails a check

### Requirement: Palette contrast checks

The checks SHALL be: `fgOnPrimary` against `primary` at a contrast ratio of at
least 4.5:1, and `primary` against both the light page background and the dark page background at
least 3:1. Every generated and type palette SHALL pass them; curated palettes are hand-tuned
overrides and SHALL be exempt. The palettes SHALL be committed in
`lib/theme/generated-palettes.json`, covering every species in the seed.

#### Scenario: Type palettes pass

- **WHEN** the unit tests run
- **THEN** every one of the 18 type palettes passes both checks

#### Scenario: Curated palette below the bar

- **WHEN** Pikachu's curated primary `#D4A800` is 2.1:1 on the light background
- **THEN** Pikachu still uses its curated palette

### Requirement: Extraction tries several hues before falling back

Before a species falls back to its type palette, `npm run seed:palettes` SHALL try up to three of the
sprite's most common distinct hues as `primary`, each at its extracted lightness and then stepped by
at most 15 percentage points of HSL lightness either way (hue and saturation unchanged), and SHALL
keep the first candidate that passes the checks.

#### Scenario: Pale yellow sprite

- **WHEN** a sprite's dominant yellow is 2:1 on the light background but passes once darkened by 12 points
- **THEN** that species gets the darkened yellow as `primary`, not its type palette

### Requirement: The theme comes from a mastered species (MODIFIED from the baseline curated rule)

The theme picker SHALL offer every species that is mastered at species level in any enrolled locale
(the #1865 predicate, unchanged), as a search, plus "Match my favourite" when the favourite is
mastered. Choosing one SHALL save `favouriteTheme` as `{ id, name, colors, spriteUrl }` (the same
shape as today, `name` the English seed name and `colors` that species' palette) and apply it as
today.

#### Scenario: Theme while the favourite is unlearned

- **WHEN** Gengar is the favourite but not mastered, and Pikachu is mastered
- **THEN** the theme search offers Pikachu, not Gengar, and "Match my favourite" is not offered

#### Scenario: A non-curated theme

- **WHEN** the player has mastered Bulbasaur and chooses it as the theme
- **THEN** Bulbasaur's palette from `generated-palettes.json` is applied and `favouriteTheme.id` is 1

#### Scenario: An older app version reads a non-curated theme

- **WHEN** a device on the previous release loads a settings blob whose `favouriteTheme.id` is 1
- **THEN** it shows the default palette and does not write the theme back as null

### Requirement: The locked state and unmastered favourites

With nothing mastered, the locked state SHALL show as today. A favourite that is not mastered
SHALL never recolour the app.

#### Scenario: Nothing mastered

- **WHEN** the player has mastered nothing and has a favourite
- **THEN** the theme section shows the locked state and the default palette stays

### Requirement: Mastering the favourite offers its colours once

When the favourite becomes mastered (or is set while already mastered) and the theme is not already
that species, the app SHALL offer once "Switch to <name>'s colours?" on the next all-done screen or
Settings visit. Accepting SHALL make the theme the favourite; declining SHALL leave the theme alone.
The offer SHALL be recorded as the last species offered (`favouriteThemeOfferedForId`), so it is not
repeated while that species stays the favourite. The wording SHALL be neutral, with no urgency.

#### Scenario: Gengar mastered

- **WHEN** Gengar is the favourite, Pikachu is the theme, and Gengar reaches species-level mastery
- **THEN** the next all-done screen offers Gengar's colours once; after either answer it is not offered again for Gengar

### Requirement: Stored themes are validated against the seed (MODIFIED from the baseline)

On read, `favouriteTheme` SHALL be accepted when `id` is a species id in the seed and its colours are
valid hex; otherwise it SHALL be treated as no theme (and left in storage, as today). For an accepted
theme the colours applied SHALL be that species' current palette, not the stored colours, so palette
fixes reach existing players; `spriteUrl` handling is unchanged.

#### Scenario: Palette fix reaches an old pick

- **WHEN** a player chose Gardevoir before its `fgOnPrimary` was corrected
- **THEN** the corrected colours are applied on the next load

#### Scenario: Unknown id

- **WHEN** the stored theme has id 999999
- **THEN** no theme is applied

### Requirement: A theme kept after mastery lapses can still be removed (MODIFIED from the baseline grandfather rule)

A stored valid theme SHALL stay applied on load without a mastery check (the #1865 grandfather rule),
and the theme section in Settings SHALL always show the current theme with a Remove button, even when
its species is no longer mastered.

#### Scenario: Lapsed theme

- **WHEN** Pikachu is the theme and its mastery has lapsed
- **THEN** the palette stays applied and Settings shows Pikachu as the current theme with Remove

### Requirement: Reset progress clears the theme but keeps the favourite and hearts (MODIFIED from the baseline)

Reset progress SHALL behave as today for the theme (saves `favouriteTheme: null` after the wipe, kept
if the cloud wipe fails) and SHALL also clear `priorityNewSpeciesIds`, `favouriteThemeOfferedForId` and
`learnFirstAskedSpeciesIds`.
It SHALL keep `favouritePokemonId` and `heartedSpeciesIds`, which are preferences, not progress.
Deleting the account SHALL clear everything, as today.

#### Scenario: Guest resets

- **WHEN** a guest with Gengar as favourite and theme confirms Reset progress
- **THEN** the default palette shows, Gengar is still the favourite and hearted, and the priority list is empty

### Requirement: Superuser pretend-all-mastered counts the favourite as mastered (MODIFIED from the baseline)

With `pretendAllMastered` on, every species SHALL count as mastered for the theme picker, "Match my
favourite", partner art and the Pasture spot. Exit cleanup SHALL keep clearing an unearned theme as
today and SHALL NOT change `favouritePokemonId` or `heartedSpeciesIds`. While any flag is on, cloud
writes SHALL stay suppressed, so favourite and heart changes stay on the device.

#### Scenario: Cheat theme, flag off

- **WHEN** a player without Charizard mastered turns on `pretendAllMastered`, makes Charizard favourite and theme, then turns the flag off and the cloud pull succeeds
- **THEN** the theme is cleared, and the favourite is whatever the cloud holds

### Requirement: Names are localised (REPLACES the baseline "English in every locale" rule)

Every Pokémon name shown by the favourite, hearts, theme picker and partner surfaces SHALL go through
`useLocalePokemonName`; `favouriteTheme.name` SHALL stay the English seed name in storage. All new
copy SHALL be in the message catalogue in `en`, `ja`, `zh-Hans` and `zh-Hant`.

#### Scenario: Chinese theme picker

- **WHEN** the active learning locale is `zh-Hans` and Pikachu is mastered
- **THEN** the theme picker shows Pikachu's Simplified Chinese name

### Requirement: Existing players carry their theme over as their favourite

On load, when `favouritePokemonId` is null or missing, the settings blob has never held it, and a
valid `favouriteTheme` exists, the app SHALL set `favouritePokemonId` to the theme's id and heart it,
once. The colours on screen SHALL not change.

#### Scenario: Upgrade

- **WHEN** a player with Umbreon as their theme opens the new release
- **THEN** Umbreon is their favourite and hearted, and the Umbreon palette is unchanged

#### Scenario: Cleared favourite is not refilled

- **WHEN** that player later clears their favourite
- **THEN** it stays cleared on the next load

### Requirement: The favourite appears as your partner

When a favourite is set, it SHALL appear on the Journey trainer card, on the "Share today" and
milestone share images, on the all-done screen beside the Pokémon of the day, and (once mastered) in a
highlighted spot in Pasture. On the trainer card, share images and all-done screen it SHALL show as a
silhouette with its name until it is mastered at species level, then as its full sprite.

#### Scenario: Unmastered partner on a share image

- **WHEN** Gengar is the favourite and not mastered, and the player shares today
- **THEN** the image shows Gengar's silhouette and name

#### Scenario: Mastered partner

- **WHEN** Gengar becomes mastered
- **THEN** the trainer card, share images and all-done screen show its full sprite and Pasture shows it in its highlighted spot

#### Scenario: Cry on tap

- **WHEN** the player taps the partner on the all-done screen
- **THEN** Gengar's cry plays once; arriving at the screen plays nothing

### Requirement: The partner's cry plays only on a tap

Tapping the
partner on the all-done screen SHALL play its cry (nothing when the species has no cry); the cry
SHALL never play by itself. With no favourite, the trainer card SHALL show a "Choose your favourite"
link to the Pokédex, and the other surfaces SHALL show nothing new.

#### Scenario: No cry

- **WHEN** the favourite has no cry and the player taps it
- **THEN** nothing plays

### Requirement: Learning the favourite first is offered once

When the player sets a favourite that is not mastered, the app SHALL ask once, for that species:
"Learn <name>'s evolution line next?". Yes SHALL set `priorityNewSpeciesIds` to the species in its
evolution family (from `lib/evolution/chains.ts`) that are not yet introduced, in chain order; No or
dismissing SHALL change nothing. The question SHALL not be repeated for the same species on any
device: asked species are recorded in the synced list `learnFirstAskedSpeciesIds`.

#### Scenario: Yes

- **WHEN** a player makes Haunter the favourite and answers Yes
- **THEN** `priorityNewSpeciesIds` is Gastly, Haunter, Gengar (minus any already introduced)

#### Scenario: Already mastered

- **WHEN** the player makes a mastered species the favourite
- **THEN** no question is asked

### Requirement: The new settings sync, and older versions never delete them

`favouritePokemonId`, `heartedSpeciesIds`, `priorityNewSpeciesIds`, `favouriteThemeOfferedForId` and
`learnFirstAskedSpeciesIds` SHALL be top-level settings keys that sync like any other setting for signed-in players and stay in
localStorage for guests. The lists SHALL be arrays (never objects), so removing an item reaches the
cloud through the deep merge. A device on the previous release SHALL never remove them from the
cloud row.

#### Scenario: Older version edits another setting

- **WHEN** a device on the previous release changes its daily new-card cap
- **THEN** its patch holds only that key and the cloud row keeps `heartedSpeciesIds` and `favouritePokemonId`

#### Scenario: Guest then sign-in

- **WHEN** a guest with a favourite and hearts signs in to an account with none
- **THEN** the conflict picker's chosen side decides the whole settings blob, the new keys included, as for every other setting
