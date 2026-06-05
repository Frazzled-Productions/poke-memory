/**
 * lib/journey/closeToMastery.ts
 *
 * Pure helper for deriving the "close to mastery" list - species where the
 * name card has cleared the mastery gate (scheduledDays >= MASTERY_INTERVAL_DAYS
 * AND reps >= masteryRepetitions) but the paired reverse card has not yet
 * reached that bar.
 *
 * The 0.10.22 mastery rule requires BOTH legs before a species is counted as
 * fully mastered. This helper surfaces the gap so users know exactly which
 * reverse cards to focus on next.
 *
 * Cross-layer note: this file lives in lib/ (data-coder's ownership boundary)
 * but was authored by ui-coder as part of the Journey "Close to mastery"
 * feature (#1312). The pure-function nature makes the cross-layer touch safe -
 * no I/O, no side effects, no framework imports.
 */

import type { ReviewableCard, ReverseReviewCard } from "@/lib/review/session";
import { isMastered, MASTERY_REPETITIONS } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** One entry in the "close to mastery" list. */
export type CloseToMasteryEntry = {
  /** PokéAPI species ID - matches SeedPokemon.speciesId. */
  speciesId: number;
  /** English display name (fallback; locale-aware name resolved at the component layer). */
  englishName: string;
  /** Self-hosted sprite URL for the species. */
  spriteUrl: string;
  /** The reverse card's current scheduledDays - shows how close it is to the 21-day gate. */
  reverseScheduledDays: number;
  /** The reverse card's current reps - shows repetition progress toward the gate. */
  reverseReps: number;
  /** Whether the reverse card has been seen at all (lastReview !== null). */
  reverseIntroduced: boolean;
};

// ---------------------------------------------------------------------------
// deriveCloseToMastery
// ---------------------------------------------------------------------------

/**
 * Returns the list of species where the name card has reached mastery but
 * the reverse card has not. Sorted by "closest first" - species whose
 * reverse card has the highest scheduledDays come first, so the user can
 * immediately see which are almost done.
 *
 * When `forceAllMastered` is true (superuser pretendAllMastered mode) the
 * list is always empty - there is nothing left to close the gap on.
 *
 * @param cards               Full card array (all card types).
 * @param masteryRepetitions  Minimum reps for the mastery gate (default: MASTERY_REPETITIONS = 3).
 * @param forceAllMastered    When true, returns []. Superuser override.
 */
export function deriveCloseToMastery(
  cards: readonly ReviewableCard[],
  masteryRepetitions = MASTERY_REPETITIONS,
  forceAllMastered = false,
): readonly CloseToMasteryEntry[] {
  if (forceAllMastered) return [];

  // Build a lookup map: pokemonId -> reverse card.
  // Reverse card pokemonId === the name card's id for default-form species.
  const reverseBySpeciesId = new Map<number, ReverseReviewCard>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    const rc = card as ReverseReviewCard;
    reverseBySpeciesId.set(rc.pokemonId, rc);
  }

  const result: CloseToMasteryEntry[] = [];

  for (const card of cards) {
    if (card.cardType !== "name") continue;

    // Skip if the name card itself has not cleared the mastery gate.
    if (!isMastered(card.state, masteryRepetitions)) continue;

    // Look up the paired reverse card.
    const reverse = reverseBySpeciesId.get(card.id);

    // If there is no reverse card yet (reverse cards disabled in settings),
    // or the reverse card has not yet cleared the mastery gate, include this species.
    if (reverse === undefined || !isMastered(reverse.state, masteryRepetitions)) {
      result.push({
        speciesId: card.speciesId ?? card.id,
        englishName: card.displayName,
        spriteUrl: card.spriteUrl ?? "",
        reverseScheduledDays: reverse?.state.scheduledDays ?? 0,
        reverseReps: reverse?.state.reps ?? 0,
        reverseIntroduced: reverse !== undefined && reverse.state.lastReview !== null,
      });
    }
  }

  // Sort: highest reverseScheduledDays first (closest to the 21-day gate).
  // Tie-break by reps descending, then speciesId ascending for determinism.
  result.sort((a, b) => {
    const daysDiff = b.reverseScheduledDays - a.reverseScheduledDays;
    if (daysDiff !== 0) return daysDiff;
    const repsDiff = b.reverseReps - a.reverseReps;
    if (repsDiff !== 0) return repsDiff;
    return a.speciesId - b.speciesId;
  });

  return result;
}
