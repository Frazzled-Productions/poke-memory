import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { POKEMON_TYPES } from "@/lib/pokemon/types";

// ---------------------------------------------------------------------------
// Mastery classification
// ---------------------------------------------------------------------------

export type CardClass = "locked" | "learning" | "mastered";

/** Minimum consecutive successful reviews for mastery — mastery also requires interval >= MASTERY_INTERVAL_DAYS. */
export const MASTERY_REPETITIONS = 3;
/** A card is "mastered" once its projected review interval reaches this many days. */
export const MASTERY_INTERVAL_DAYS = 21;

export function isMastered(state: ReviewState, masteryRepetitions = MASTERY_REPETITIONS): boolean {
  // FSRS swap: reps replaces repetitions, scheduledDays replaces interval.
  // Mastery semantics are unchanged — N successful reviews and the next
  // scheduled interval is ≥ MASTERY_INTERVAL_DAYS.
  return state.reps >= masteryRepetitions && state.scheduledDays >= MASTERY_INTERVAL_DAYS;
}

/**
 * Locked: card has never been graded (lastReview === null).
 * Learning: graded at least once, but not yet mastered.
 * Mastered: repetitions >= masteryRepetitions AND interval >= 21.
 */
export function classifyCard(card: ReviewableCard, masteryRepetitions = MASTERY_REPETITIONS): CardClass {
  if (card.state.lastReview === null) return "locked";
  if (isMastered(card.state, masteryRepetitions)) return "mastered";
  return "learning";
}

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export type GenerationRange = {
  gen: number;   // 1..9
  name: string;  // "Generation I", "Generation II", ...
  first: number; // first PokéDex ID inclusive
  last: number;  // last PokéDex ID inclusive
};

/**
 * Hardcoded canonical generation boundaries for IDs 1–1025.
 *   Gen I:    1..151
 *   Gen II:   152..251
 *   Gen III:  252..386
 *   Gen IV:   387..493
 *   Gen V:    494..649
 *   Gen VI:   650..721
 *   Gen VII:  722..809
 *   Gen VIII: 810..905
 *   Gen IX:   906..1025
 */
export const GEN_RANGES: readonly GenerationRange[] = [
  { gen: 1, name: "Generation I",    first: 1,    last: 151  },
  { gen: 2, name: "Generation II",   first: 152,  last: 251  },
  { gen: 3, name: "Generation III",  first: 252,  last: 386  },
  { gen: 4, name: "Generation IV",   first: 387,  last: 493  },
  { gen: 5, name: "Generation V",    first: 494,  last: 649  },
  { gen: 6, name: "Generation VI",   first: 650,  last: 721  },
  { gen: 7, name: "Generation VII",  first: 722,  last: 809  },
  { gen: 8, name: "Generation VIII", first: 810,  last: 905  },
  { gen: 9, name: "Generation IX",   first: 906,  last: 1025 },
] as const;

/** Returns 1..9 for any valid PokéDex ID, or 0 if out of range. */
export function generationOf(id: number): number {
  for (const range of GEN_RANGES) {
    if (id >= range.first && id <= range.last) return range.gen;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Top-level stats result
// ---------------------------------------------------------------------------

export type GenerationStats = {
  gen: number;
  name: string;
  total: number;       // species in this generation
  introduced: number;  // count where lastReview !== null
  mastered: number;    // count where repetitions >= masteryRepetitions AND interval >= MASTERY_INTERVAL_DAYS
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
  /** Lowercase canonical type slug (`fire`, `water`, ...) — same vocabulary as `POKEMON_TYPES`. */
  type: string;
  total: number;       // name cards whose `types[]` includes this type
  introduced: number;
  mastered: number;
};

export type StatsResult = {
  totalCards: number;                    // name cards only, ~1025
  introduced: number;                    // lastReview !== null
  learning: number;                      // introduced && !mastered
  mastered: number;                      // repetitions >= masteryRepetitions param AND interval >= MASTERY_INTERVAL_DAYS
  locked: number;                        // lastReview === null (== totalCards - introduced)
  /**
   * 14-entry array, today first then 13 future days. Day 0 ("today") is the
   * same population as the queue: introduced cards whose dueDate is <= today
   * and that haven't been reviewed today yet — i.e. cards that will appear
   * for review right now. Days 1..13 are exact dueDate matches on that
   * future date, so the forecast surfaces clustering ahead.
   */
  dueForecast: readonly DueForecastDay[];
  perGeneration: readonly GenerationStats[];
  perType: readonly TypeStats[];          // 18 entries, alphabetical by `POKEMON_TYPES` order
  struggling: readonly StrugglingCard[]; // bottom-N introduced cards by easeFactor, ascending
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute tomorrow's ISO date string from today's "YYYY-MM-DD" string.
 * Mirrors the `addDays` pattern in lib/srs/scheduler.ts exactly: parse to
 * Date, increment via local-time `setDate`, format via UTC `toISOString`.
 * The two halves of the codebase must use the same date arithmetic to
 * avoid divergent results in negative-UTC offset timezones.
 */
function tomorrowString(today: string): string {
  return addDaysToIsoDate(today, 1);
}

/**
 * Add `days` to an ISO `YYYY-MM-DD` string. Same convention as
 * `tomorrowString`: parse via local-time, increment via `setDate`,
 * format via UTC `toISOString` — matches the scheduler so forecasts
 * align with queue date math.
 */
function addDaysToIsoDate(date: string, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
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
 * Compute all stats from the full card array. Pure — no I/O.
 * `today` is a YYYY-MM-DD string (use `todayString(now)` from session.ts).
 * `strugglingLimit` defaults to 10.
 *
 * Card filters:
 *   - `introduced` cards = `lastReview !== null`.
 *   - `learning` cards = introduced AND NOT isMastered (repetitions < masteryRepetitions OR interval < 21).
 *   - `mastered` cards = repetitions >= masteryRepetitions AND interval >= 21.
 *   - `dueToday` excludes cards already reviewed today (matches the queue policy).
 *   - `dueTomorrow` is exact-match on tomorrow's ISO date.
 *   - `struggling` is the bottom `strugglingLimit` *introduced* cards sorted
 *     ascending by `easeFactor`, tie-broken by lower repetitions, then by lower id.
 *   - `perGeneration` covers all 9 generations even when introduced=0.
 */
export function computeStats(
  cards: readonly NameReviewCard[],
  today: string,
  strugglingLimit = 10,
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
): StatsResult {
  // Pre-compute the 14 forecast date strings so the inner loop can do a
  // single Map lookup per card instead of a 14-way comparison chain.
  const forecastDates: string[] = [];
  for (let i = 0; i < DUE_FORECAST_DAYS; i++) {
    forecastDates.push(i === 0 ? today : addDaysToIsoDate(today, i));
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

  // Cards eligible for "struggling" — introduced cards only.
  const introducedCards: NameReviewCard[] = [];

  for (const card of cards) {
    const state = card.state;
    const isIntroduced  = state.lastReview !== null;
    const isCardMastered = isMastered(state, masteryRepetitions);

    // Mastery / learning / locked tallies.
    if (isIntroduced) {
      introduced++;
      if (isCardMastered) {
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
    // reviewed today — matches the queue policy in `buildSessionQueues`.
    if (state.lastReview !== null) {
      if (state.dueDate <= today && state.lastReview !== today) {
        forecastCounts[0]++;
      }
      const futureIdx = forecastIndex.get(state.dueDate);
      if (futureIdx !== undefined && futureIdx > 0) {
        forecastCounts[futureIdx]++;
      }
    }

    // Per-generation tallies.
    const gen = generationOf(card.id);
    if (gen >= 1 && gen <= 9) {
      const idx = gen - 1;
      genTotal[idx]++;
      if (isIntroduced)   genIntroduced[idx]++;
      if (isCardMastered) genMastered[idx]++;
    }

    // Per-type tallies. A dual-type card increments both buckets, so the
    // sum across types exceeds `totalCards` (≈1025 × ~1.7 types/card).
    // Unknown / typo'd types are silently ignored — the buckets are
    // pre-seeded only with `POKEMON_TYPES`.
    for (const t of card.types) {
      const total = typeTotal.get(t);
      if (total === undefined) continue;
      typeTotal.set(t, total + 1);
      if (isIntroduced)   typeIntroduced.set(t, (typeIntroduced.get(t) ?? 0) + 1);
      if (isCardMastered) typeMastered.set(t, (typeMastered.get(t) ?? 0) + 1);
    }
  }

  // Build perGeneration array — all 9 gens always present.
  const perGeneration: GenerationStats[] = GEN_RANGES.map((range, idx) => ({
    gen:        range.gen,
    name:       range.name,
    total:      genTotal[idx],
    introduced: genIntroduced[idx],
    mastered:   genMastered[idx],
  }));

  // Build struggling list: bottom-N introduced cards by FSRS difficulty,
  // descending (higher difficulty = struggling), tie-broken by fewer reps,
  // then lower id. The exported StrugglingCard keeps the legacy
  // `easeFactor` / `repetitions` field names — they are derived from the
  // FSRS state so existing UI consumers continue to work. (`easeFactor` here
  // is the inverse of FSRS difficulty, mapped onto the old SM-2 1.3..2.5 range.)
  const struggling: StrugglingCard[] = [...introducedCards]
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
      totalCards: cards.length,
      introduced: cards.length,
      learning: 0,
      mastered: cards.length,
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
    totalCards: cards.length,
    introduced,
    learning,
    mastered,
    locked: cards.length - introduced,
    dueForecast,
    perGeneration,
    perType,
    struggling,
  };
}
