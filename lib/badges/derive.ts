import type { ReviewableCard } from "@/lib/review/session";
import { isMastered } from "@/lib/stats/derive";

/** The numeric offset added to a species ID to produce its reverse-card ID. */
const REVERSE_ID_OFFSET = 2_000_000;

/**
 * Build the set of species IDs that are fully mastered. A species is mastered
 * when BOTH its name card AND its reverse card have cleared the FSRS mastery
 * gate (`reps >= masteryRepetitions && scheduledDays >= 21`). Since #1234,
 * reverse is a required practice direction, so species-level mastery requires
 * both legs.
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
  // Build a quick lookup of mastered reverse-card species IDs.
  // Reverse card ID = REVERSE_ID_OFFSET + pokemonId.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state, masteryRepetitions))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  const out = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if (forceAllMastered) {
      out.add(card.id);
    } else if (
      isMastered(card.state, masteryRepetitions) &&
      masteredReverseSpecies.has(card.id)
    ) {
      out.add(card.id);
    }
  }
  return out;
}
