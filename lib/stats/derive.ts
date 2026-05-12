import type { ReviewableCard, NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

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

export type StatsResult = {
  totalCards: number;                    // name cards only, ~1025
  introduced: number;                    // lastReview !== null
  learning: number;                      // introduced && !mastered
  mastered: number;                      // repetitions >= masteryRepetitions param AND interval >= MASTERY_INTERVAL_DAYS
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
      if (isIntroduced)   genIntroduced[idx]++;
      if (isCardMastered) genMastered[idx]++;
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
