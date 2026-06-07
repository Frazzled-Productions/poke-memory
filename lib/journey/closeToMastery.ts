/**
 * lib/journey/closeToMastery.ts
 *
 * Pure helper for deriving the "close to mastery" list - species where the
 * name card has cleared the mastery gate but the paired reverse card has not
 * yet reached that bar.
 *
 * The 0.10.22 mastery rule requires BOTH legs before a species is counted as
 * fully mastered. This helper surfaces the gap so users know exactly which
 * reverse cards to focus on next.
 *
 * Since #1765, mastery uses FSRS stability (>= MASTERY_STABILITY_DAYS = 21)
 * rather than the old `reps >= 3` sub-gate.
 *
 * Since the #1766/#1767 data layer, this helper delegates to
 * `computeSpeciesLegStatuses` (lib/stats/legStatus.ts) so there is a single
 * derivation of "blocked species" in the codebase. It filters to species
 * where `isBlocked && blockingLeg === "reverse"`.
 *
 * Cross-layer note: this file lives in lib/ (data-coder's ownership boundary)
 * but was authored by ui-coder as part of the Journey "Close to mastery"
 * feature (#1312). The pure-function nature makes the cross-layer touch safe -
 * no I/O, no side effects, no framework imports.
 */

import type { ReviewableCard, ReverseReviewCard } from "@/lib/review/session";
import { computeSpeciesLegStatuses } from "@/lib/stats/legStatus";

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
 * Delegates to `computeSpeciesLegStatuses` to detect blocked species, then
 * filters to those where `blockingLeg === "reverse"`.
 *
 * @param cards               Full card array (all card types).
 * @param forceAllMastered    When true, returns []. Superuser override.
 */
export function deriveCloseToMastery(
  cards: readonly ReviewableCard[],
  forceAllMastered = false,
): readonly CloseToMasteryEntry[] {
  if (forceAllMastered) return [];

  // Build a lookup of reverse cards by pokemonId for metadata extraction.
  const reverseBySpeciesId = new Map<number, ReverseReviewCard>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    const rc = card as ReverseReviewCard;
    reverseBySpeciesId.set(rc.pokemonId, rc);
  }

  // Build name card lookup for metadata extraction.
  const nameCardBySpeciesId = new Map<number, ReviewableCard>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    nameCardBySpeciesId.set(card.id, card);
  }

  // Derive blocked species using the single-source-of-truth helper.
  const legStatuses = computeSpeciesLegStatuses(cards, "en", forceAllMastered);

  const result: CloseToMasteryEntry[] = [];

  for (const [speciesId, status] of legStatuses) {
    // Only interested in species blocked by the reverse leg.
    if (!status.isBlocked || status.blockingLeg !== "reverse") continue;

    const nameCard = nameCardBySpeciesId.get(speciesId);
    if (nameCard === undefined) continue;

    const reverse = reverseBySpeciesId.get(speciesId);

    result.push({
      speciesId,
      englishName: (nameCard as { displayName?: string }).displayName ?? (nameCard as { name?: string }).name ?? "",
      spriteUrl: (nameCard as { spriteUrl?: string }).spriteUrl ?? "",
      reverseScheduledDays: reverse?.state.scheduledDays ?? 0,
      reverseReps: reverse?.state.reps ?? 0,
      reverseIntroduced: reverse !== undefined && reverse.state.lastReview !== null,
    });
  }

  // Sort: highest reverseScheduledDays first (closest to the stability gate).
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
