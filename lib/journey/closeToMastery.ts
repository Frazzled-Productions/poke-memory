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

import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";
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
  /** The reverse card's FSRS stability - drives the progress bar against the mastery gate. */
  reverseStability: number;
  /** The reverse card's current scheduledDays. */
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
 * reverse card has the highest stability come first, so the user can
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
 * @param locale              Active pokemonNameLocale - determines which name cards count as mastered.
 */
export function deriveCloseToMastery(
  cards: readonly ReviewableCard[],
  forceAllMastered: boolean,
  locale: AppLocale,
): readonly CloseToMasteryEntry[] {
  if (forceAllMastered) return [];

  // Build a lookup of reverse cards by pokemonId for metadata extraction.
  // Locale-scoped (#1851): computeSpeciesLegStatuses below is locale-filtered,
  // so without the same guard here the rendered progress bar / "-Nd" badge /
  // closest-first sort could come from a DIFFERENT locale's reverse card than
  // the one actually blocking mastery (last card in the array won).
  const reverseBySpeciesId = new Map<number, ReverseReviewCard>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const rc = card as ReverseReviewCard;
    reverseBySpeciesId.set(rc.pokemonId, rc);
  }

  // Build name card lookup for metadata extraction. Same locale guard.
  const nameCardBySpeciesId = new Map<number, ReviewableCard>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== locale) continue;
    nameCardBySpeciesId.set(card.id, card);
  }

  // Derive blocked species using the single-source-of-truth helper.
  const legStatuses = computeSpeciesLegStatuses(cards, locale, forceAllMastered);

  const result: CloseToMasteryEntry[] = [];

  for (const [speciesId, status] of legStatuses) {
    // Only interested in species blocked by the reverse leg.
    if (!status.isBlocked || status.blockingLeg !== "reverse") continue;

    const nameCard = nameCardBySpeciesId.get(speciesId);
    if (nameCard === undefined) continue;

    const reverse = reverseBySpeciesId.get(speciesId);

    result.push({
      speciesId,
      englishName: (nameCard as NameReviewCard).displayName,
      spriteUrl: (nameCard as { spriteUrl?: string }).spriteUrl ?? "",
      reverseStability: reverse?.state.stability ?? 0,
      reverseScheduledDays: reverse?.state.scheduledDays ?? 0,
      reverseReps: reverse?.state.reps ?? 0,
      reverseIntroduced: reverse !== undefined && reverse.state.lastReview !== null,
    });
  }

  // Sort: highest reverseStability first (closest to the mastery gate).
  // Tie-break by reps descending, then speciesId ascending for determinism.
  result.sort((a, b) => {
    const stabilityDiff = b.reverseStability - a.reverseStability;
    if (stabilityDiff !== 0) return stabilityDiff;
    const repsDiff = b.reverseReps - a.reverseReps;
    if (repsDiff !== 0) return repsDiff;
    return a.speciesId - b.speciesId;
  });

  return result;
}
