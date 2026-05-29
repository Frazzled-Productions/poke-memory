/**
 * masteryGap.ts — helpers for the "Close to mastery" Journey section.
 *
 * Identifies species where the NAME card has cleared the mastery interval gate
 * (scheduledDays >= MASTERY_INTERVAL_DAYS) but the paired REVERSE card has not
 * yet satisfied the full mastery gate (reps >= masteryRepetitions &&
 * scheduledDays >= MASTERY_INTERVAL_DAYS).
 *
 * This is an asymmetric gap — the user knows a species well enough to
 * recognise the name, but has not yet cemented the reverse direction (given a
 * sprite, recall the name).
 */

import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import { isMastered, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single species in the "close to mastery" gap set. */
export type MasteryGapEntry = {
  /** PokéAPI species ID — matches NameReviewCard.speciesId (or id for default forms). */
  speciesId: number;
  /** English display name. Use `useLocalePokemonName` for locale-aware rendering. */
  name: string;
  /** Self-hosted sprite URL from the seed. */
  spriteUrl: string;
  /**
   * Progress proxy for the reverse card, used to order entries
   * closest-to-mastery first.
   *
   * Both are 0 when the reverse card exists but has never been reviewed.
   */
  reverseReps: number;
  reverseScheduledDays: number;
};

// ---------------------------------------------------------------------------
// computeMasteryGap
// ---------------------------------------------------------------------------

/**
 * Returns species that are "close to mastery": name card has graduated past
 * the interval gate (scheduledDays >= MASTERY_INTERVAL_DAYS) but the paired
 * reverse card is not yet fully mastered.
 *
 * Ordering: closest-to-mastery first, proxied by
 * (reverseScheduledDays DESC, reverseReps DESC, speciesId ASC).
 *
 * Returns an empty array when:
 * - `forceAllMastered` is true (superuser pretend mode).
 * - The session contains no reverse cards (reverse card type disabled).
 *
 * @param cards                Full mixed card array from the review session.
 * @param masteryRepetitions   From UserSettings (default 3).
 * @param forceAllMastered     Superuser `pretendAllMastered` flag.
 * @param limit                Maximum entries to return (default 10).
 */
export function computeMasteryGap(
  cards: readonly ReviewableCard[],
  masteryRepetitions = 3,
  forceAllMastered = false,
  limit = 10,
): MasteryGapEntry[] {
  if (forceAllMastered) return [];

  // Index reverse cards by the species (pokemon) ID they pair with.
  // ReverseReviewCard.pokemonId is the same as the paired NameReviewCard.id.
  // For multi-locale sessions, keep the first reverse card found per species
  // (locale "en" is the default and the one used for the gap check).
  const reverseBySpeciesId = new Map<number, ReverseReviewCard>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    const rev = card as ReverseReviewCard;
    if (!reverseBySpeciesId.has(rev.pokemonId)) {
      reverseBySpeciesId.set(rev.pokemonId, rev);
    }
  }

  const gap: MasteryGapEntry[] = [];

  for (const card of cards) {
    if (card.cardType !== "name") continue;
    const nameCard = card as NameReviewCard;

    // Name card must have graduated past the interval gate.
    if (nameCard.state.scheduledDays < MASTERY_INTERVAL_DAYS) continue;

    // If no reverse card exists in the session (reverse cards disabled), there
    // is nothing actionable to show for this species.
    const revCard = reverseBySpeciesId.get(nameCard.id);
    if (revCard === undefined) continue;

    // Species already fully mastered — both legs passed the gate.
    if (isMastered(revCard.state, masteryRepetitions)) continue;

    gap.push({
      speciesId: nameCard.speciesId ?? nameCard.id,
      name: nameCard.name,
      spriteUrl: nameCard.spriteUrl,
      reverseReps: revCard.state.reps,
      reverseScheduledDays: revCard.state.scheduledDays,
    });
  }

  // Sort: highest reverseScheduledDays first (nearest to crossing the 21-day
  // threshold), then highest reverseReps, then speciesId ascending for
  // deterministic ordering.
  gap.sort((a, b) => {
    const byDays = b.reverseScheduledDays - a.reverseScheduledDays;
    if (byDays !== 0) return byDays;
    const byReps = b.reverseReps - a.reverseReps;
    if (byReps !== 0) return byReps;
    return a.speciesId - b.speciesId;
  });

  return gap.slice(0, limit);
}
