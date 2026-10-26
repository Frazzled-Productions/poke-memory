## Why

Today a "favourite" is only a theme. Settings offers 11 hand-tuned species, each unlocked once
mastered, and choosing one recolours the app and shows a nav mascot. Nothing else in the app knows
about it, so a player whose favourite is any of the other 1014 species, or one they have not
learned yet, cannot say so (#2187; research `research/pokememory-favourite-pokemon-2026-10-26.md` in
Frazzled-Productions/ops). This is change 1 of 2: it makes the favourite a real thing across the
app. Change 2 (the favourite finder: knockout bracket and daily duels) follows in its own proposal.

## What Changes

- **Any species can be your favourite.** There is one favourite, stored as a new synced setting
  `favouritePokemonId` (a species id or null), separate from the theme. You set it from a new
  "Make favourite" button on every Pokédex detail page (silhouettes included), or from a search over
  all 1025 species in Settings (names in the active learning locale).
- **Hearts.** A heart button on every Pokédex detail page adds the species to `heartedSpeciesIds`
  (a synced array, newest first, no repeats). The favourite is always hearted. Hearted species show a
  small heart in the Pokédex grid. A "Favourites" preset joins Starters and Legendaries in the
  practice Scope control once you have at least one heart.
- **A palette for every species.** A new seed step (`npm run seed:palettes`, using the `sharp`
  already used by `seed:sprites`) extracts four colours from each sprite and keeps them only when
  they pass the contrast checks in the spec. Any that fail use one of 18 new hand-tuned type palettes
  (by primary type). The 11 curated palettes stay as overrides. The output is committed as
  `lib/theme/generated-palettes.json`.
- **The theme stays a mastery reward, now from any mastered species.** The existing
  `favouriteTheme` setting keeps meaning "the colours on screen", so older app versions keep working.
  The theme picker becomes a search over every species you have mastered, plus "Match my favourite"
  once your favourite is mastered. When your favourite becomes mastered, the app offers once to switch
  to its colours. A favourite never recolours the app before it is mastered.
- **Your partner.** The favourite appears on the Journey trainer card, on the "Share today" and
  milestone share images, in its own highlighted spot in Pasture (once mastered) and on the all-done
  screen beside the Pokémon of the day, where tapping it plays its cry. Until it is mastered it shows
  as a silhouette (with its name), following the Pokédex disclosure rule.
- **Learn your favourite first (opt-in, offered once).** Setting a favourite you have not mastered
  asks once: "Learn <name>'s evolution line next?". Yes puts that line's species into a new synced
  `priorityNewSpeciesIds` list, and those species are introduced first as new cards within the normal
  daily new-card cap and the current scope.
- **Existing players carry over.** A player with a `favouriteTheme` and no `favouritePokemonId` gets
  that species as their favourite (and hearted) on first load; their colours do not change.
- **Fixes from the baseline that this change touches anyway.** A theme kept after its mastery lapsed
  can now be removed (oddity 1); picker and partner names go through `useLocalePokemonName`
  (oddity 2); the stored colours of a known species are replaced by its current palette on read, so
  palette fixes reach existing players (oddity 3). Scope presets now come from one shared list,
  which the Favourites preset needs. That also stops "Almost mastered" being dropped on every
  reload (scope baseline oddity 1, root cause the three-entry allow-list at
  `lib/settings/persistence.ts:667`).
- A What's new entry, QA-seed scenarios for "favourite set, not mastered" and "favourite mastered",
  copy in all four locales, regenerated README screenshots, and a `minor-bump` changelog fragment.

## Also touches

- **Review and quiz screens (home):** the all-done screen gains the partner (tap for its cry) next to
  `components/review/DailySpotlight.tsx`. New-card selection honours `priorityNewSpeciesIds`
  (baseline `new-card-order`). The Scope control gains the "Favourites" preset (baseline
  `practice-scope`). Review grading and FSRS are unchanged.
- **Pokédex:** detail page gains "Make favourite" and heart buttons; the grid shows a heart badge on
  hearted species. Silhouette and disclosure rules for everything else are unchanged.
- **Pasture:** a mastered favourite gets a highlighted spot (`lib/pasture/assign.ts`); every other
  placement is unchanged.
- **Stats:** `components/stats/TrainerCard.tsx` (rendered on Journey) shows the partner. Stats charts
  are unchanged.
- **Journey:** the trainer card hero shows the partner, or a "Choose your favourite" link to the
  Pokédex when none is set.
- **Settings:** the 11-species grid is replaced by two searches (favourite: all 1025; theme: your
  mastered species plus "Match my favourite"). Intensity is unchanged.
- **What's new:** one entry pointing at the Pokédex "Make favourite" button.
- **Guest mode (localStorage):** the three new keys live in `poke-memory:settings:v1` like every other
  setting.
- **Cloud sync and Supabase migrations (both projects):** no migration. The three new top-level keys
  ride the existing `merge_user_settings` deep merge. Proven safe for older versions (see the safety
  fact below). `user_settings_reject_regression_trigger` (migration 038) does not guard these keys, so
  removing a heart is allowed.
- **Superuser mode and QA-seed scenarios:** `pretendAllMastered` counts the favourite as mastered
  (full sprite, theme unlocked, Pasture spot). Exit cleanup keeps clearing an unearned theme, as
  today, and never clears the favourite or hearts. Two new QA-seed scenarios.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** about 20 new catalogue keys in all four,
  plus a regenerated pseudo-locale; every Pokémon name through `useLocalePokemonName`.
- **Push notifications and the service worker (offline):** no change to push. The palettes file
  ships in the bundle and works offline.
- **Sign-in:** no change. The guest-to-sign-in conflict picker carries the new keys with the rest of
  the settings blob.
- **Privacy notice and sub-processors:** no change, because the notice already covers synced
  "application preferences (… theme …)" (`app/privacy/page.tsx:163`) and no new processor or data
  category is added. The Children's Code re-check for the learn-hook prompt (one neutral, opt-in
  question, never repeated) is recorded in `docs/childrens-code-assessment.md` Standard 13.
- **Accessibility:** heart and favourite buttons are toggle buttons with `aria-pressed` and
  localised labels; the partner is labelled with its name; the cry plays only on a tap; palettes pass
  the contrast checks; no new motion.
- **README screenshots:** Journey, Pokédex and Pasture are regenerated (`npm run screenshots`).
- **Changelog fragments and the release:** one `kind: minor-bump` fragment, which needs Fraser's
  `version-bump:approved` label.
- **CI and GitHub Actions:** no workflow change. A test fails if `generated-palettes.json` is
  missing a species or a palette fails contrast.

**Safety fact (blast radius).** An older app version on another device never deletes the new data.
Its settings loader rebuilds the blob field by field, so it drops unknown keys locally, and its sync
pushes only keys that differ from its last pushed snapshot. So the new keys never appear in its
patch, and `jsonb_deep_merge` (migration 036) leaves keys absent from a patch alone. Checked on
2026-10-26: the client half ran against the shipped `main` code in a throwaway test (an older client
loading a blob with `hearts` and a Bulbasaur theme, then changing another setting, pushed a patch of
only `maxNewPerDay`; 1 passed). The SQL half was walked through, not run (no local Postgres); task
6.2 adds the integration test. Two consequences shape the design. First, the new lists are arrays,
not objects: the deep merge recurses into objects, so a key removed from an object would never
reach the cloud. Second, `favouriteTheme` keeps its full `{ id, name, colors, spriteUrl }` shape:
the deep merge would keep stale `colors` under a new `id` if the shape shrank.

## Removes

- The 11-entry `FavouritePicker` grid in `app/settings/page.tsx` (replaced by the two searches).
- The rule that only `CURATED_POKEMON` species can be a theme (`validateRawFavourite`'s curated-id
  check becomes "a valid species id"); `CURATED_POKEMON` stays as palette overrides.
- The three hand-kept preset allow-lists (settings validator, push route, `ScopeControl`'s
  `PRESET_KEYS`), replaced by the shared `PRESET_IDS`.
- The baseline rule that picker names are English in every locale.

## Out of scope

- The favourite finder: bracket, daily duels, ranking and the `/favourite` page (change 2).
- A personality quiz (dropped in the research).
- The baseline oddities this change does not need. Theme 4 to 10: pre-paint id check, invalid
  stored values never cleared, `BRAND_DEFAULT_COLORS` duplication, superuser exit on any flag, stale
  comments, picker snapshot, sprite rewrite test. Scope 4 and 5: English scope chip, wrong doc comment (scope 2, the server push treating "Almost
  mastered" as empty, is fixed here as a side effect of the shared list, with a route test). New-card 1 to 4: species grouping
  (#928) rarely applies, the #1764 tier has no visible effect, the "I already know these" quiz uses
  up the day's budget, UTC against local day. All are in #2188.
- Multiple favourites or a fixed team (hearts cover the shortlist).

## Owner decisions relied on

All from Fraser on 2026-10-26 (grilling recorded on #2187):

- Any of the 1025 species can be the favourite; one favourite plus an open hearts list.
- Palettes are auto-generated with a contrast check, falling back to type palettes; curated palettes
  stay as overrides.
- The theme unlocks on mastery; until then any mastered species can theme the app; when the favourite
  is mastered the app offers once to switch.
- Partner on the Journey card, share images, Pasture and the all-done screen; a silhouette until
  mastered; the cry plays on a tap.
- Learn hook: offered once, opt-in.
- Set from Pokédex detail, Settings search and (in change 2) the finder result. No onboarding step.
- Two changes, this one first.
- Defaults accepted: existing theme carries over; guests local, signed-in synced; heart badge and
  "Favourites" scope from 1 heart; the favourite is always hearted; Children's Code re-check recorded.

## Clarifications

- 2026-10-26 Q: Which species can be your favourite? A: Any of the 1025.
- 2026-10-26 Q: One favourite or a shortlist too? A: One favourite plus hearts.
- 2026-10-26 Q: Theme colours outside the 11 curated? A: Auto-generate with a contrast check.
- 2026-10-26 Q: How do the two changes ship? A: Two changes, favourite-everywhere first.
- 2026-10-26 Q: Where does the partner appear? A: Journey trainer card, share images, Pasture spot, all-done screen.
- 2026-10-26 Q: Is the theme still a mastery reward? A: Yes, the favourite's colours unlock on mastery.
- 2026-10-26 Q: Learning hook for an unmastered favourite? A: Offer once, opt-in.
- 2026-10-26 Q: Daily duel in v1 of the finder? A: Yes (change 2).
- 2026-10-26 Q: Where can you set the favourite and hearts? A: Pokédex detail, Settings search, finder result.
- 2026-10-26 Q: Theme before the favourite is mastered? A: Yes, from any mastered species.
- 2026-10-26 Q: Palette that fails contrast? A: Its type's palette.
- 2026-10-26 Q: Finder pools and bracket size? A: All, generation, type, hearts, mastered; 32 by default (change 2).
- 2026-10-26 Q: Duel pool? A: You choose; contenders by default (change 2).
- 2026-10-26 Q: Duel cadence? A: 3 a day on the all-done screen plus unlimited on the finder page (change 2).
- 2026-10-26 Q: Duels with no contenders? A: Taste-weighted from all 1025 (change 2).
- 2026-10-26 Q: Duel number 1 is not your favourite? A: Suggest, never switch (change 2).
- 2026-10-26 Q: Finder home? A: A page linked from Pokédex and Journey, no new tab (change 2).
- 2026-10-26 Q: Labs flag? A: No, ship it on (change 2).
- 2026-10-26 Q: Unmastered favourite on partner surfaces? A: Silhouette until mastered.
- 2026-10-26 Q: Partner cry on the all-done screen? A: Tap to play.
- 2026-10-26 Q: Defaults (carry-over, sync, heart badge, nudge re-check, favourite always hearted)? A: All fine.
- 2026-10-26 Q: Unlearned species in the finder? A: Full sprite, name hidden until learned (change 2).
- 2026-10-26 Q: Reset progress and the favourite? A: Keep the favourite and hearts; clear the theme, learn-first list and offer marker.
- 2026-10-26 Q: Favourite mastered with no theme set? A: Still ask once; never recolour without a yes.
- 2026-10-26 Q: Learn-first against a narrow scope? A: Respect the scope; priority cards wait until it includes them.
- 2026-10-26 Q: Only 261 of 1025 extracted palettes passed contrast; what now? A: Smarter extraction first (up to 3 hues, bounded lightness steps), type palette as the last resort.
- 2026-10-26 Q: Curated palettes fail the new checks; exempt them? A: Yes, exempt and unchanged.
- 2026-10-26 Q: The learn-first 'already asked' marker was device-local; sync it? A: Yes, as a fifth synced key (built as the list `learnFirstAskedSpeciesIds`).
