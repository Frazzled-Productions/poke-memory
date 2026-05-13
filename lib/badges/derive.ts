import type { ReviewableCard } from "@/lib/review/session";
import { isMastered } from "@/lib/stats/derive";

/**
 * Build the set of species IDs whose name card meets the mastery
 * criterion. Other card directions (evolution, reverse, cry) do not
 * contribute — a badge is unlocked when the user knows the *species*
 * name forward, which is the cardinal direction.
 *
 * When `forceAllMastered` is true (superuser `pretendAllMastered`),
 * every name-card species is returned regardless of FSRS state. Callers
 * pass it through directly from `useSuperuser().flags.pretendAllMastered`.
 */
export function masteredSpeciesIds(
  cards: readonly ReviewableCard[],
  masteryRepetitions: number,
  forceAllMastered: boolean,
): Set<number> {
  const out = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if (forceAllMastered || isMastered(card.state, masteryRepetitions)) {
      out.add(card.id);
    }
  }
  return out;
}
