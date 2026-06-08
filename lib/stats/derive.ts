import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
// Import the numeric constant from seed-builder (no JSON dependency) so
// derive.ts does NOT force the seed JSON into the boot chunk.
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-builder";
import { POKEMON_TYPES } from "@/lib/pokemon/types";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { addDaysToIsoDate as sharedAddDaysToIsoDate } from "@/lib/utils/dates";
// Import and re-export seed-free generation helpers so all existing callers
// importing from this module continue to work unchanged.
import { GEN_RANGES, generationOf } from "@/lib/stats/generationOf";
export { GEN_RANGES, generationOf } from "@/lib/stats/generationOf";
export type { GenerationRange } from "@/lib/stats/generationOf";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Mastery classification
// ---------------------------------------------------------------------------

export type CardClass = "locked" | "learning" | "mastered";

/**
 * Minimum consecutive successful reviews used in the old reps-based mastery
 * gate. No longer gates `isMastered` since #1765 (which replaced the reps
 * sub-gate with a stability-based gate). Retained for:
 *   - Test fixtures that seed believable card states.
 *   - QA-seed scenarios that still use it to describe card states.
 *   - Backup schema validation (existing exports include this field).
 * Do NOT use this in any new mastery-checking code path.
 */
export const MASTERY_REPETITIONS = 3;
/** A card is "mastered" once its FSRS stability reaches this many days (#1765). */
export const MASTERY_STABILITY_DAYS = 21;
/** Progress-bar display bound for `scheduledDays`; the mastery gate is `MASTERY_STABILITY_DAYS`. */
export const MASTERY_INTERVAL_DAYS = 21;

// ---------------------------------------------------------------------------
// Struggling-card thresholds (srs-expert spec, issue #736)
// ---------------------------------------------------------------------------

/**
 * Minimum number of graduated reviews before a card is eligible for the
 * "Struggling cards" list. Graduated reviews (state.reps) are set only on
 * graduation or lapse - not on in-step learning touches - so a value of 3
 * means the card has completed at least three full FSRS review cycles. At
 * that point FSRS difficulty has stabilised enough to be a meaningful signal.
 * Matching MASTERY_REPETITIONS is intentional: a card needs the same number
 * of reviews to either master or legitimately struggle.
 */
export const STRUGGLING_MIN_REPS = 3;

/**
 * FSRS difficulty above which a card is considered genuinely struggling even
 * when lapses === 0. FSRS difficulty runs 1–10 (higher = harder); the default
 * initial difficulty after a "Good" first grade is ~5.0. Reaching 7 requires
 * a sustained run of Hard/Again responses because each "Good" pushes
 * difficulty back toward 5. A difficulty of 7+ puts the card in the "hard"
 * learning-step band (≥ 8) or approaching it, and corresponds to significantly
 * elevated scheduling cost - the card warrants attention even without a
 * recorded lapse.
 */
export const STRUGGLING_DIFFICULTY_CUTOFF = 7;

/**
 * Returns true when the card's FSRS stability has reached the mastery
 * threshold (#1765).
 *
 * Since #1765 mastery uses `stability` rather than the old `reps >= 3`
 * sub-gate. At the default 0.9 retention target, stability is approximately
 * equal to the next scheduled interval, so `stability >= 21` means the
 * scheduler itself has confidence the user will retain the card for at least
 * three weeks. A lapse that drives stability below 21 reverts the card to
 * learning; gym badges (once earned) are latched separately and unaffected.
 */
export function isMastered(state: ReviewState): boolean {
  return state.stability >= MASTERY_STABILITY_DAYS;
}

/**
 * Locked: card has never been graded (lastReview === null).
 * Learning: graded at least once, but not yet mastered.
 * Mastered: stability >= MASTERY_STABILITY_DAYS.
 */
export function classifyCard(card: ReviewableCard): CardClass {
  if (card.state.lastReview === null) return "locked";
  if (isMastered(card.state)) return "mastered";
  return "learning";
}

/**
 * Lazy-initialised Map from pokemon ID → species ID, built from the async seed.
 * Falls back to the pokemon's own `id` for entries where `speciesId` is not
 * yet populated (pre-seed-expansion state of generated.json, where all IDs
 * are in 1..1025 and speciesId === id). This keeps generation lookups correct
 * for the current seed while also correctly routing form IDs (10001+) to
 * their species' generation once the seed re-runs.
 *
 * Only memoises when the seed is already loaded; returns an empty Map if the
 * seed is not yet available (so a later call after load recomputes correctly).
 */
let _idToSpeciesIdMap: Map<number, number> | null = null;
function getIdToSpeciesIdMap(): Map<number, number> {
  if (_idToSpeciesIdMap !== null) return _idToSpeciesIdMap;
  const seed = getSeedIfLoaded();
  if (!seed) return new Map();  // not loaded yet: do not cache
  _idToSpeciesIdMap = new Map(
    seed.seedPokemon.map((p) => [p.id, p.speciesId ?? p.id]),
  );
  return _idToSpeciesIdMap;
}

/**
 * Resolve a raw pokemon ID to its species ID via the seed, then return
 * the generation. Returns 0 for IDs not found in the seed (e.g. retired
 * namespaced card IDs, or IDs not yet in the seed).
 *
 * Use this when the caller only has a pokemon `id` (e.g. a card ID) and
 * not the seed record itself. When you already have a `SeedPokemon` or
 * `NameReviewCard`, prefer passing `.speciesId` directly to `generationOf`.
 */
export function generationOfPokemonId(pokemonId: number): number {
  const speciesId = getIdToSpeciesIdMap().get(pokemonId);
  if (speciesId === undefined) return 0;
  return generationOf(speciesId);
}

// ---------------------------------------------------------------------------
// Top-level stats result
// ---------------------------------------------------------------------------

export type GenerationStats = {
  gen: number;
  name: string;
  total: number;       // species in this generation
  introduced: number;  // count where lastReview !== null
  mastered: number;    // count where stability >= MASTERY_STABILITY_DAYS
};

export type StrugglingCard = {
  id: number;
  name: string;
  spriteUrl: string;
  easeFactor: number;
  repetitions: number;
};

export type DueForecastDay = {
  date: string;     // YYYY-MM-DD
  count: number;    // cards whose dueDate falls on this day
};

export type TypeStats = {
  /** Lowercase canonical type slug (`fire`, `water`, ...) - same vocabulary as `POKEMON_TYPES`. */
  type: string;
  total: number;       // name cards whose `types[]` includes this type
  introduced: number;
  mastered: number;
};

export type StatsResult = {
  totalCards: number;                    // name cards only, ~1025
  introduced: number;                    // lastReview !== null
  learning: number;                      // introduced && !mastered
  mastered: number;                      // stability >= MASTERY_STABILITY_DAYS
  locked: number;                        // lastReview === null (== totalCards - introduced)
  /**
   * 14-entry array, today first then 13 future days. Day 0 ("today") is the
   * same population as the queue: introduced cards whose dueDate is <= today
   * and that haven't been reviewed today yet - i.e. cards that will appear
   * for review right now. Days 1..13 are exact dueDate matches on that
   * future date, so the forecast surfaces clustering ahead.
   */
  dueForecast: readonly DueForecastDay[];
  perGeneration: readonly GenerationStats[];
  perType: readonly TypeStats[];          // 18 entries, alphabetical by `POKEMON_TYPES` order
  /** Introduced cards that pass both struggle gates (reps >= STRUGGLING_MIN_REPS AND lapsed at least once or difficulty >= STRUGGLING_DIFFICULTY_CUTOFF), sorted by FSRS difficulty descending, capped at strugglingLimit. */
  struggling: readonly StrugglingCard[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute tomorrow's ISO date string from today's "YYYY-MM-DD" string.
 * Delegates to the canonical helper in lib/utils/dates so the two halves
 * of the codebase stay in sync.
 */
function tomorrowString(today: string): string {
  return sharedAddDaysToIsoDate(today, 1);
}

/**
 * Number of forward-looking days to surface in the due forecast,
 * including today. Currently 14 (today + 13 future days).
 */
export const DUE_FORECAST_DAYS = 14;

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

/**
 * Compute all stats from the full card array. Pure - no I/O.
 * `today` MUST be a UTC YYYY-MM-DD string (use `todayString(now)` with no
 * timezone argument from session.ts). Card `dueDate` and `lastReview` fields
 * are stored as UTC dates by the FSRS scheduler, so passing a user-timezone
 * "today" would cause the due-forecast to miscount cards when the local date
 * differs from the UTC date.
 * `strugglingLimit` defaults to 10.
 *
 * Card filters:
 *   - `introduced` cards = `lastReview !== null`.
 *   - `learning` cards = introduced AND NOT isMastered (stability < MASTERY_STABILITY_DAYS).
 *   - `mastered` cards = stability >= MASTERY_STABILITY_DAYS.
 *   - `dueToday` excludes cards already reviewed today (matches the queue policy).
 *   - `dueTomorrow` is exact-match on tomorrow's ISO date.
 *   - `struggling` is the top `strugglingLimit` introduced cards that pass both
 *     gates: reps >= STRUGGLING_MIN_REPS AND (lapses > 0 OR difficulty >=
 *     STRUGGLING_DIFFICULTY_CUTOFF). Sorted by FSRS difficulty descending,
 *     tie-broken by fewer reps then lower id.
 *   - `perGeneration` covers all 9 generations even when introduced=0.
 *
 * Since #1234 the function accepts the **full** mixed card array (all card
 * types), not just name cards. It filters internally and builds the set of
 * species IDs whose reverse card also passes the mastery gate before counting
 * a species as mastered - matching the rule in `filterMastered` and
 * `masteredSpeciesIds`. Callers that previously filtered to name cards first
 * should now pass the full array; the stats figures will then correctly reflect
 * the both-legs-required mastery rule.
 */
export function computeStats(
  cards: readonly ReviewableCard[],
  today: string,
  strugglingLimit = 10,
  forceAllMastered = false,
  locale: AppLocale = "en",
): StatsResult {
  // Build the set of species IDs whose reverse card has cleared the mastery
  // gate in the given locale. Reverse card ID = REVERSE_ID_OFFSET + pokemonId;
  // subtracting the offset recovers the species/pokemon ID that pairs with the
  // name card. In forceAllMastered mode every reverse is considered mastered.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  // Extract name cards for this locale for the per-species stats loop below.
  const nameCards = cards.filter(
    (c): c is NameReviewCard => c.cardType === "name" && (c.locale ?? "en") === locale,
  );

  // Pre-compute the 14 forecast date strings so the inner loop can do a
  // single Map lookup per card instead of a 14-way comparison chain.
  const forecastDates: string[] = [];
  for (let i = 0; i < DUE_FORECAST_DAYS; i++) {
    forecastDates.push(i === 0 ? today : sharedAddDaysToIsoDate(today, i));
  }
  const forecastIndex = new Map<string, number>();
  forecastDates.forEach((d, i) => forecastIndex.set(d, i));
  const forecastCounts = new Array<number>(DUE_FORECAST_DAYS).fill(0);

  // Per-generation accumulators keyed by gen index (0-based into GEN_RANGES).
  const genTotal      = new Array<number>(GEN_RANGES.length).fill(0);
  const genIntroduced = new Array<number>(GEN_RANGES.length).fill(0);
  const genMastered   = new Array<number>(GEN_RANGES.length).fill(0);

  // Per-type accumulators keyed by type slug. Always all 18 types so the UI
  // can render a stable grid regardless of which species the user has touched.
  const typeTotal      = new Map<string, number>();
  const typeIntroduced = new Map<string, number>();
  const typeMastered   = new Map<string, number>();
  for (const t of POKEMON_TYPES) {
    typeTotal.set(t, 0);
    typeIntroduced.set(t, 0);
    typeMastered.set(t, 0);
  }

  let introduced = 0;
  let learning   = 0;
  let mastered   = 0;

  // Cards eligible for "struggling" - introduced name cards only.
  const introducedCards: NameReviewCard[] = [];

  for (const card of nameCards) {
    const state = card.state;
    const isIntroduced  = state.lastReview !== null;
    // Since #1234, species-level mastery requires BOTH name AND reverse cards
    // to pass the FSRS gate. Check that the paired reverse card is also
    // mastered before counting this species as mastered.
    const nameCardMastered = isMastered(state);
    const isSpeciesMastered = forceAllMastered
      ? true
      : nameCardMastered && masteredReverseSpecies.has(card.id);
    // Mastery / learning / locked tallies.
    if (isIntroduced) {
      introduced++;
      if (isSpeciesMastered) {
        mastered++;
      } else {
        learning++;
      }
      introducedCards.push(card);
    }

    // Due-forecast tallies. Every day requires `lastReview !== null` so
    // that never-reviewed cards (which carry a default dueDate of today and
    // flow through the new-card queue, not the review queue) don't inflate
    // the chart. Day 0 ("today") additionally excludes anything already
    // reviewed today - matches the queue policy in `buildSessionQueues`.
    if (state.lastReview !== null) {
      if (state.dueDate <= today && state.lastReview !== today) {
        forecastCounts[0]++;
      }
      const futureIdx = forecastIndex.get(state.dueDate);
      if (futureIdx !== undefined && futureIdx > 0) {
        forecastCounts[futureIdx]++;
      }
    }

    // Per-generation tallies. Use speciesId so alternate-form cards (id ≥ 10001)
    // inherit their base species' generation (e.g. Alolan Raichu → Gen I).
    // Fall back to card.id for pre-expansion seed entries where speciesId is
    // not yet populated (speciesId === id for all default-form-only seeds).
    const gen = generationOf(card.speciesId ?? card.id);
    if (gen >= 1 && gen <= 9) {
      const idx = gen - 1;
      genTotal[idx]++;
      if (isIntroduced)   genIntroduced[idx]++;
      if (isSpeciesMastered) genMastered[idx]++;
    }

    // Per-type tallies. A dual-type card increments both buckets, so the
    // sum across types exceeds `totalCards` (≈1025 × ~1.7 types/card).
    // Unknown / typo'd types are silently ignored - the buckets are
    // pre-seeded only with `POKEMON_TYPES`.
    for (const t of card.types) {
      const total = typeTotal.get(t);
      if (total === undefined) continue;
      typeTotal.set(t, total + 1);
      if (isIntroduced)      typeIntroduced.set(t, (typeIntroduced.get(t) ?? 0) + 1);
      if (isSpeciesMastered) typeMastered.set(t, (typeMastered.get(t) ?? 0) + 1);
    }
  }

  // Build perGeneration array - all 9 gens always present.
  const perGeneration: GenerationStats[] = GEN_RANGES.map((range, idx) => ({
    gen:        range.gen,
    name:       range.name,
    total:      genTotal[idx],
    introduced: genIntroduced[idx],
    mastered:   genMastered[idx],
  }));

  // Build struggling list: cards that pass both gates - 
  //   1. Minimum reviews: state.reps >= STRUGGLING_MIN_REPS (enough FSRS cycles
  //      for difficulty to have stabilised; filters out freshly-introduced cards).
  //   2. Genuine-struggle signal: state.lapses > 0 (lapsed at least once) OR
  //      state.difficulty >= STRUGGLING_DIFFICULTY_CUTOFF (persistently high
  //      difficulty even without an explicit lapse).
  // Within the qualifying set, sort by FSRS difficulty descending (highest
  // difficulty first), tie-broken by fewer reps then lower id. The exported
  // StrugglingCard keeps the legacy `easeFactor` / `repetitions` field names - 
  // they are derived from the FSRS state so existing UI consumers continue to
  // work. (`easeFactor` here is the inverse of FSRS difficulty, mapped onto the
  // old SM-2 1.3..2.5 range.)
  const struggling: StrugglingCard[] = [...introducedCards]
    .filter(
      (card) =>
        card.state.reps >= STRUGGLING_MIN_REPS &&
        (card.state.lapses > 0 ||
          card.state.difficulty >= STRUGGLING_DIFFICULTY_CUTOFF),
    )
    .sort((a, b) => {
      const diffDiff = b.state.difficulty - a.state.difficulty;
      if (diffDiff !== 0) return diffDiff;
      const repDiff = a.state.reps - b.state.reps;
      if (repDiff !== 0) return repDiff;
      return a.id - b.id;
    })
    .slice(0, strugglingLimit)
    .map((card) => {
      const ease = 2.5 - ((card.state.difficulty - 1) * 1.2) / 9;
      return {
        id:          card.id,
        name:        card.name,
        spriteUrl:   card.spriteUrl,
        easeFactor:  Math.min(2.5, Math.max(1.3, ease)),
        repetitions: card.state.reps,
      };
    });

  const dueForecast: DueForecastDay[] = forecastDates.map((date, i) => ({
    date,
    count: forecastCounts[i],
  }));

  const perType: TypeStats[] = POKEMON_TYPES.map((t) => ({
    type:       t,
    total:      typeTotal.get(t)      ?? 0,
    introduced: typeIntroduced.get(t) ?? 0,
    mastered:   typeMastered.get(t)   ?? 0,
  }));

  if (forceAllMastered) {
    // Superuser pretendAllMastered: overlay "everything is mastered" on the
    // result. Real counters are preserved on dueForecast (a forward-looking
    // schedule view, not a completion metric). Struggling is cleared because
    // a fully-mastered user has nothing to struggle with.
    return {
      totalCards: nameCards.length,
      introduced: nameCards.length,
      learning: 0,
      mastered: nameCards.length,
      locked: 0,
      dueForecast,
      perGeneration: perGeneration.map((g) => ({
        ...g,
        introduced: g.total,
        mastered: g.total,
      })),
      perType: perType.map((t) => ({
        ...t,
        introduced: t.total,
        mastered: t.total,
      })),
      struggling: [],
    };
  }

  return {
    totalCards: nameCards.length,
    introduced,
    learning,
    mastered,
    locked: nameCards.length - introduced,
    dueForecast,
    perGeneration,
    perType,
    struggling,
  };
}
