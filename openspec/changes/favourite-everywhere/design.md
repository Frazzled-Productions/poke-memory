## Context

Baselines written from code and tests on 2026-10-26 (`qa` at the worktree's base): the theme
(`lib/theme/`, `components/theme/`, `app/settings/page.tsx`), practice scope (`lib/review/scope.ts`,
`components/review/ScopeControl.tsx`) and new-card order (`lib/review/session.ts`). They are folded
into the three delta specs as "(baseline, current behaviour)" requirements.

## Decisions

### Favourite and theme are two settings

`favouriteTheme` keeps meaning "the colours on screen", with its current
`{ id, name, colors, spriteUrl }` shape, so the previous release keeps painting the theme it
understands (any curated id) and shows the default for the rest. The favourite is a new scalar,
`favouritePokemonId`. Alternatives rejected: renaming `favouriteTheme` (the previous release would
lose every theme), or nesting the favourite inside it (the deep merge keeps stale nested keys).

### Lists are arrays

`heartedSpeciesIds` and `priorityNewSpeciesIds` are arrays. `jsonb_deep_merge` (migration 036)
recurses into objects, so a key deleted from an object never reaches the cloud; an array is replaced
whole. `favouriteThemeOfferedForId` is a scalar (the last species offered).

### Palettes are generated at seed time

`scripts/seed-palettes.mjs` (run by `npm run seed:palettes`) loads each sprite through `sharp` (the
Next.js transitive dependency `seed:sprites` already uses, not added to `package.json`), drops
transparent and near-white or near-black pixels, buckets the rest into a coarse colour histogram and
takes the most common hue as `primary`, the next distinct hue as `accent`, a lighter tint of `primary`
as `secondary`, and black or white for `fgOnPrimary`, whichever contrasts more. A palette that fails
either check uses the species' primary-type palette from `lib/theme/type-palettes.ts`. Output:
`lib/theme/generated-palettes.json` (about 1025 × 4 hex strings, roughly 40 KB uncompressed),
imported only by `lib/theme/palette.ts` (`paletteFor(id)`), which applies curated, then generated,
then type. Light and dark page backgrounds for the check come from `app/globals.css`.

### Preset ids live in one list

`PRESET_IDS` is exported from `lib/review/scope.ts` and used by `parseScopeShape`,
`validatePracticeScope`, the push route, `ScopeControl` and `scopeLabel`. A test greps the seven
known sites for a preset string literal that is not on the list. This also stops "Almost mastered"
being dropped on reload (baseline oddity 1), whose root cause is the three-entry allow-list at
`lib/settings/persistence.ts:667`.

### Priority species hook in at two points

`buildSessionQueues` (`lib/review/session.ts:618`) takes an optional `priorityNewSpeciesIds` after
`activeLocale`:

1. Before the cut to budget (`session.ts:768-770` for name, reverse and cry; `:845` for evolution,
   anchored on `preEvoId`): a stable partition puts priority candidates first, in list order.
2. After the final reshuffle (`session.ts:852`): a stable partition moves admitted priority new
   cards ahead of other new cards. Reviews still come first (`getNextCardId`, `:879-886`).

Ranking at the species-tier step (`:810-823`) would do nothing, because the cut has already
happened. All four calls in `components/review/ReviewSession.tsx` (1457, 1734, 1912, 2647) pass the
same list from settings. `lib/stats/dashboard-snapshot.ts:172` only counts and is left alone.
Species leave the list when the session records their last enabled-direction first sighting in the
active locale. Evolution families come from `deriveEvolutionFamilies` (`lib/evolution/chains.ts`).

### Partner art

A `PartnerSprite` component (sizes from `lib/sprites/sizes.ts`, `next/image`) renders the full
sprite when mastered (or `pretendAllMastered`), otherwise the silhouette treatment the Pokédex grid
uses, and always the localised name. The share-image generators
(`lib/share/generateShareImage.ts:522`, `:571`) take an optional partner `{ spriteUrl, name,
silhouette }`. Pasture's spot is a fixed slot in the favourite's habitat zone
(`lib/pasture/assign.ts`), highlighted by a ring, outside the normal placement.

## Risks

- **Palette quality:** some generated palettes may pass the numbers and still look wrong. Mitigation:
  `app/audit-themes` (existing page) shows every palette for a visual pass, and any species can be
  added to `CURATED_POKEMON` by hand.
- **Bundle size:** about 40 KB of JSON. Mitigation: imported only by the theme code and the settings
  page, not the review screen; checked in the build output (task 7.3).
- **Older versions:** covered by the safety fact in the proposal and the integration test in task
  6.2.
- **Baseline oddities left alone:** new-card species grouping (#928) and the #1764 tier have little
  visible effect today; this change does not depend on them and does not fix them (follow-up issue,
  task 8.1).
