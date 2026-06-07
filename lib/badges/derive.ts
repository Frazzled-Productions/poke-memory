import type { ReviewableCard } from "@/lib/review/session";
import { isMastered } from "@/lib/stats/derive";
import type { AppLocale } from "@/i18n/locales";

/** The numeric offset added to a species ID to produce its reverse-card ID. */
const REVERSE_ID_OFFSET = 2_000_000;

/**
 * Build the set of species IDs that are fully mastered in the given locale.
 * A species is mastered when BOTH its name card AND its reverse card have
 * cleared the FSRS mastery gate (stability >= MASTERY_STABILITY_DAYS).
 * Since #1234, reverse is a required practice direction, so species-level
 * mastery requires both legs.
 *
 * Since #1259, mastery is scoped to `locale` (defaults to `"en"` for
 * backward-compatibility). Only cards whose `locale` matches are counted.
 *
 * Since #1765, mastery uses FSRS stability (>= 21) rather than `reps >= 3`.
 *
 * Badges are locale-agnostic at award time - once earned, always earned.
 * The `locale` parameter scopes which cards count toward earning a badge,
 * so a user can earn mastery badges in English and keep them when switching
 * to Japanese. The Journey page passes the current locale so progress toward
 * unearned badges reflects the active locale.
 *
 * When `forceAllMastered` is true (superuser `pretendAllMastered`),
 * every name-card species in the given locale is returned regardless of FSRS state.
 * Callers pass it through directly from `useSuperuser().flags.pretendAllMastered`.
 */
export function masteredSpeciesIds(
  cards: readonly ReviewableCard[],
  forceAllMastered: boolean,
  locale: AppLocale = "en",
): Set<number> {
  // Build a quick lookup of mastered reverse-card species IDs for this locale.
  // Reverse card ID = REVERSE_ID_OFFSET + pokemonId.
  const masteredReverseSpecies = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "reverse") continue;
    if ((card.locale ?? "en") !== locale) continue;
    const speciesId = card.id - REVERSE_ID_OFFSET;
    if (speciesId > 0 && (forceAllMastered || isMastered(card.state))) {
      masteredReverseSpecies.add(speciesId);
    }
  }

  const out = new Set<number>();
  for (const card of cards) {
    if (card.cardType !== "name") continue;
    if ((card.locale ?? "en") !== locale) continue;
    if (forceAllMastered) {
      out.add(card.id);
    } else if (
      isMastered(card.state) &&
      masteredReverseSpecies.has(card.id)
    ) {
      out.add(card.id);
    }
  }
  return out;
}
