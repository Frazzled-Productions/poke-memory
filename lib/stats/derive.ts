import type { ReviewableCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Mastery classification
// ---------------------------------------------------------------------------

export type CardClass = "locked" | "learning" | "mastered";

/** A card is "mastered" once it has this many consecutive successful reviews. */
export const MASTERY_REPETITIONS = 3;

/**
 * Locked: card has never been graded (lastReview === null).
 * Learning: graded at least once, but repetitions < MASTERY_REPETITIONS.
 * Mastered: repetitions >= MASTERY_REPETITIONS.
 */
export function classifyCard(card: ReviewableCard, masteryRepetitions = MASTERY_REPETITIONS): CardClass {
  if (card.state.lastReview === null) return "locked";
  if (card.state.repetitions >= masteryRepetitions) return "mastered";
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
  mastered: number;    // count where repetitions >= masteryRepetitions
};

export type StrugglingCard = {
  id: number;
  name: string;
  spriteUrl: string;
  easeFactor: number;
  repetitions: number;
};

export type StatsResult = {
  totalCards: number;                    // SEED_POKEMON.length, typically 1025
  introduced: number;                    // lastReview !== null
  learning: number;                      // introduced && !mastered
  mastered: number;                      // repetitions >= masteryRepetitions param
  locked: number;                        // lastReview === null (== totalCards - introduced)
  dueToday: number;                      // dueDate <= today AND lastReview !== today
  dueTomorrow: number;                   // dueDate === tomorrow's ISO date
  perGeneration: readonly GenerationStats[];
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
  const result = new Date(today);
  result.setDate(result.getDate() + 1);
  return result.toISOString().slice(0, 10);
}

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
 *   - `learning` cards = introduced AND repetitions < MASTERY_REPETITIONS.
 *   - `mastered` cards = repetitions >= MASTERY_REPETITIONS.
 *   - `dueToday` excludes cards already reviewed today (matches the queue policy).
 *   - `dueTomorrow` is exact-match on tomorrow's ISO date.
 *   - `struggling` is the bottom `strugglingLimit` *introduced* cards sorted
 *     ascending by `easeFactor`, tie-broken by lower repetitions, then by lower id.
 *   - `perGeneration` covers all 9 generations even when introduced=0.
 */
export function computeStats(
  cards: readonly ReviewableCard[],
  today: string,
  strugglingLimit = 10,
  masteryRepetitions = MASTERY_REPETITIONS,
): StatsResult {
  const tomorrow = tomorrowString(today);

  // Per-generation accumulators keyed by gen index (0-based into GEN_RANGES).
  const genTotal      = new Array<number>(GEN_RANGES.length).fill(0);
  const genIntroduced = new Array<number>(GEN_RANGES.length).fill(0);
  const genMastered   = new Array<number>(GEN_RANGES.length).fill(0);

  let introduced = 0;
  let learning   = 0;
  let mastered   = 0;
  let dueToday   = 0;
  let dueTomorrow = 0;

  // Cards eligible for "struggling" — introduced cards only.
  const introducedCards: ReviewableCard[] = [];

  for (const card of cards) {
    const state = card.state;
    const isIntroduced = state.lastReview !== null;
    const isMastered   = state.repetitions >= masteryRepetitions;

    // Mastery / learning / locked tallies.
    if (isIntroduced) {
      introduced++;
      if (isMastered) {
        mastered++;
      } else {
        learning++;
      }
      introducedCards.push(card);
    }

    // Due-date tallies. Match the queue policy in `buildSessionQueues`:
    // a card is "due today" only if it has been reviewed before — locked
    // (never-reviewed) cards go into the new queue, not the review queue,
    // so they shouldn't inflate this count on a fresh load.
    if (
      state.lastReview !== null &&
      state.dueDate <= today &&
      state.lastReview !== today
    ) {
      dueToday++;
    }
    if (state.dueDate === tomorrow) {
      dueTomorrow++;
    }

    // Per-generation tallies.
    const gen = generationOf(card.id);
    if (gen >= 1 && gen <= 9) {
      const idx = gen - 1;
      genTotal[idx]++;
      if (isIntroduced) genIntroduced[idx]++;
      if (isMastered)   genMastered[idx]++;
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

  // Build struggling list: bottom-N introduced cards by easeFactor ascending,
  // tie-broken by lower repetitions, then lower id.
  const struggling: StrugglingCard[] = [...introducedCards]
    .sort((a, b) => {
      const efDiff = a.state.easeFactor - b.state.easeFactor;
      if (efDiff !== 0) return efDiff;
      const repDiff = a.state.repetitions - b.state.repetitions;
      if (repDiff !== 0) return repDiff;
      return a.id - b.id;
    })
    .slice(0, strugglingLimit)
    .map((card) => ({
      id:          card.id,
      name:        card.name,
      spriteUrl:   card.spriteUrl,
      easeFactor:  card.state.easeFactor,
      repetitions: card.state.repetitions,
    }));

  return {
    totalCards: cards.length,
    introduced,
    learning,
    mastered,
    locked: cards.length - introduced,
    dueToday,
    dueTomorrow,
    perGeneration,
    struggling,
  };
}
