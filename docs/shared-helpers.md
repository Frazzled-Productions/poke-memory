# Shared helpers (single source of truth)

Moved out of `AGENTS.md` (2026-10-14). The principle and the poke-memory forcing functions are in
AGENTS.md, "Single source of truth for shared concepts"; this is the list of existing helpers.

**Existing helpers - use these, do not re-derive.**

- `useLocalePokemonName(id, fallback)` from `lib/i18n/useLocalePokemonName.ts` - Pokémon name rendering (locale-aware).
- `formatDate(iso, fmt, tz)` / `formatShortDate(iso, fmt)` from `lib/utils/format-date.ts` - user-facing date display. `todayInTimezone(tz)` for the current day boundary; `isoDate(d)` for the scheduling-internal `"YYYY-MM-DD"` form.
- `isMastered(state)` from `lib/stats/derive.ts` - single mastery check.
- `filterMastered(cards, …)` from `lib/pasture/arrivals.ts` - mastery filter honouring the superuser `forceAllMastered` axis.
- `computeStats(…)` from `lib/stats/derive.ts` - aggregate stats with the same superuser axis.
- `masteredSpeciesIds(…)` from `lib/badges/derive.ts` - mastered species set.
- `useCardClass(…)` from `lib/review/useCardClass.ts` - card-class derivation.
- Class-name constants in `lib/utils/class-names.ts` (`cardPanel`, `cardPanelPadded`, `colStack`, `colStackLg`, `sectionLabel`, `dialogPanel`, `statValue`, `chartTickText`, `mutedText`, `inlineLink`, `mutedTextXs`, `chartTooltipCard`) - never inline the underlying Tailwind literal.
