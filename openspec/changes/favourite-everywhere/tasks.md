## 1. Settings and carry-over

- [ ] 1.1 Add `favouritePokemonId`, `heartedSpeciesIds`, `priorityNewSpeciesIds` and `favouriteThemeOfferedForId` to `UserSettings`, defaults and `parseStoredSettings` (arrays of valid seed ids, no repeats). Verify: `lib/settings/persistence.test.ts` new cases, written failing first.
- [ ] 1.2 One-time carry-over of an existing theme to the favourite (and heart), never refilling a cleared favourite. Verify: `lib/theme/persistence.test.ts` "Upgrade" and "Cleared favourite is not refilled".
- [ ] 1.3 Favourite always hearted; heart toggle cannot remove the favourite. Verify: unit test on the hearts helpers.

## 2. Palettes

- [ ] 2.1 `lib/theme/type-palettes.ts` (18 palettes) and `lib/theme/palette.ts` `paletteFor(id)` (curated, then generated, then type). Verify: `lib/theme/palette.test.ts` order cases.
- [ ] 2.2 `scripts/seed-palettes.mjs` and `npm run seed:palettes`; commit `lib/theme/generated-palettes.json`. Verify: the coverage and contrast test fails on a missing species or a failing palette (red run on a fixture first), then passes on the committed file.
- [ ] 2.3 Read-time validation: any seed id; colours from `paletteFor`, not storage. Verify: "Palette fix reaches an old pick" and "Unknown id" tests.

## 3. Favourite, hearts and theme UI

- [ ] 3.1 Pokédex detail "Make favourite" and heart toggles (`aria-pressed`, localised labels); grid heart badge. Verify: component tests in all four locales; e2e `e2e/favourite.spec.ts` sets a favourite from a silhouette page.
- [ ] 3.2 Settings: favourite search over all species (active learning locale) with Clear; theme search over mastered species plus "Match my favourite"; Remove always shown for the current theme. Verify: `app/settings/page.test.tsx` cases for "Theme while the favourite is unlearned", "A non-curated theme", "Lapsed theme", "Search in Japanese".
- [ ] 3.3 One-time "Switch to <name>'s colours?" offer, recorded in `favouriteThemeOfferedForId`, neutral copy. Verify: "Gengar mastered" test.
- [ ] 3.4 Learn hook question on setting an unmastered favourite. Verify: "Yes" and "Already mastered" tests.

## 4. Partner

- [ ] 4.1 `PartnerSprite` (silhouette until mastered, `pretendAllMastered` honoured, localised name). Verify: component tests, superuser case.
- [ ] 4.2 Journey trainer card partner and "Choose your favourite" link. Verify: `components/stats/TrainerCard.test.tsx` cases.
- [ ] 4.3 Share images take the partner. Verify: `components/share/generateShareImage.test.tsx` "Unmastered partner on a share image".
- [ ] 4.4 All-done screen partner with tap-to-play cry, never autoplay. Verify: "Cry on tap" and "No cry" tests.
- [ ] 4.5 Pasture highlighted spot for a mastered favourite. Verify: `lib/pasture/assign.test.ts` case and a QA-seed screenshot.

## 5. Scope and new-card order

- [ ] 5.1 `PRESET_IDS` shared list used at all seven sites, with the guard test. Verify: guard test red on a planted literal, then green; "Reload keeps the preset" for Favourites and Almost mastered.
- [ ] 5.2 Favourites preset (client matcher, Scope control, label from the catalogue). Verify: "Practise your hearts", "Un-heart everything", "Japanese interface".
- [ ] 5.3 Push route matches Favourites against `heartedSpeciesIds`. Verify: route test "Reminder with a Favourites scope".
- [ ] 5.4 `buildSessionQueues` priority partition before the cut and after the final reshuffle; all four `ReviewSession` callers pass the list; species leave the list when fully introduced. Verify: `lib/review/session.test.ts` "Learn Gengar's line next" across 30 salt and day combinations (written failing first), "Cap already used", "Scope excludes the line", "Fully introduced".

## 6. Sync and safety

- [ ] 6.1 Reset progress clears theme, priority list and offer marker, keeps favourite and hearts; superuser exit leaves favourite and hearts alone. Verify: "Guest resets" and "Cheat theme, flag off" tests.
- [ ] 6.2 Integration test: a patch without `heartedSpeciesIds` leaves it in the cloud row; an array patch with one item removed removes it. Verify: `VITEST_INTEGRATION=1 npm run test:integration` against the local `postgres:15` container.
- [ ] 6.3 Older-client test: shipped-shape settings parse drops the new keys and pushes no patch for them. Verify: a component-project test like the blast-radius proof (2026-10-26).

## 7. Copy, docs and release

- [ ] 7.1 Catalogue keys in `en`, `ja`, `zh-Hans`, `zh-Hant`; regenerate the pseudo-locale. Verify: `npm run lint:i18n`, `npm run lint:pseudo-locale`, `npm run test:i18n-leak`.
- [ ] 7.2 What's new entry; QA-seed scenarios "favourite set, not mastered" and "favourite mastered"; `docs/childrens-code-assessment.md` Standard 13 note; README feature text; regenerated Journey, Pokédex and Pasture screenshots. Verify: `lib/qa-seed/scenarios.test.ts`, screenshots committed.
- [ ] 7.3 `minor-bump` changelog fragment (needs Fraser's `version-bump:approved`); `npm run pre-pr` exit 0; bundle check that `generated-palettes.json` is not in the review route's chunk. Verify: pre-pr output and build manifest.
- [ ] 7.4 `/opsx:verify favourite-everywhere`, blast-radius again, then the `final-review` skill. Verify: findings fixed or listed in the PR.

## 8. Follow-ups

- [x] 8.1 File one issue for the baseline oddities this change leaves alone (theme oddities 4 to 10; scope oddities 2, 4, 5; new-card oddities 1 to 4). Verify: filed as #2188 (2026-10-26).
