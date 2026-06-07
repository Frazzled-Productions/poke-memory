/**
 * lib/stats/legStatus.ts
 *
 * Per-species, per-leg mastery status helper (#1766/#1767 data foundation).
 *
 * A "leg" is one practice direction for a species: `name` (sprite shown,
 * user types/selects the name) or `reverse` (name shown, user identifies the
 * sprite). Both legs must reach the mastery threshold for a species to count
 * as mastered.
 *
 * This module is the single source of truth for the "is a species blocked?"
 * derivation: a species is "blocked" when exactly one leg is mastered and the
 * other is still needed. The UI can surface this to help users focus on the
 * missing leg. `deriveCloseToMastery` in `lib/journey/closeToMastery.ts`
 * delegates to this helper so the two cannot drift.
 */

import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";
import { isMastered } from "@/lib/stats/derive";

/** The numeric offset added to a species ID to produce its reverse-card ID. */
const REVERSE_ID_OFFSET = 2_000_000;

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * The status of a single practice leg (name or reverse) for one species.
 *
 * - `"locked"` - the leg has never been graded (lastReview === null) or has
 *   no card in the session yet.
 * - `"learning"` - the leg has been graded at least once but has not yet
 *   reached the mastery stability threshold.
 * - `"mastered"` - the leg's stability >= MASTERY_STABILITY_DAYS.
 */
export type LegStatus = "locked" | "learning" | "mastered";

/**
 * Full per-species leg status, returned by `computeSpeciesLegStatuses`.
 *
 * `isBlocked`: exactly one leg is mastered. The species is frustratingly close
 * to full mastery but cannot yet qualify because the other leg is still needed.
 *
 * `blockingLeg`: when `isBlocked` is true, this is the leg that still needs
 * work (`"name"` or `"reverse"`). When not blocked, this is `null`.
 */
export type SpeciesLegStatus = {
  speciesId: number;
  name: LegStatus;
  reverse: LegStatus;
  isBlocked: boolean;
  blockingLeg: "name" | "reverse" | null;
};

// ---------------------------------------------------------------------------
// Core derivation
// ---------------------------------------------------------------------------

/**
 * Derives per-leg mastery status for every species present in the card set.
 *
 * @param cards           The user's full ReviewableCard array (all card types).
 * @param locale          Active Pokémon-name locale - only cards whose `locale`
 *                        matches are considered. Defaults to `"en"`.
 * @param forceAllMastered  When true (superuser `pretendAllMastered`), every
 *                        species is returned with both legs mastered and not
 *                        blocked - the gate is bypassed entirely.
 * @returns A Map from speciesId → SpeciesLegStatus for every species that has
 *          at least one card in the session for the given locale.
 */
export function computeSpeciesLegStatuses(
  cards: readonly ReviewableCard[],
  locale: AppLocale = "en",
  forceAllMastered = false,
): Map<number, SpeciesLegStatus> {
  // Collect name cards and reverse cards separately, filtered to the locale.
  const nameCardBySpeciesId = new Map<number, ReviewableCard>();
  const reverseCardBySpeciesId = new Map<number, ReviewableCard>();

  for (const card of cards) {
    if ((card.locale ?? "en") !== locale) continue;
    if (card.cardType === "name") {
      // For name cards, the card id IS the species id.
      nameCardBySpeciesId.set(card.id, card);
    } else if (card.cardType === "reverse") {
      const speciesId = card.id - REVERSE_ID_OFFSET;
      if (speciesId > 0) {
        reverseCardBySpeciesId.set(speciesId, card);
      }
    }
  }

  // Build the union of all species ids present in either direction.
  const allSpeciesIds = new Set<number>([
    ...nameCardBySpeciesId.keys(),
    ...reverseCardBySpeciesId.keys(),
  ]);

  const result = new Map<number, SpeciesLegStatus>();

  for (const speciesId of allSpeciesIds) {
    const nameCard = nameCardBySpeciesId.get(speciesId);
    const reverseCard = reverseCardBySpeciesId.get(speciesId);

    const nameLeg: LegStatus = forceAllMastered
      ? "mastered"
      : nameCard === undefined
      ? "locked"
      : nameCard.state.lastReview === null
      ? "locked"
      : isMastered(nameCard.state)
      ? "mastered"
      : "learning";

    const reverseLeg: LegStatus = forceAllMastered
      ? "mastered"
      : reverseCard === undefined
      ? "locked"
      : reverseCard.state.lastReview === null
      ? "locked"
      : isMastered(reverseCard.state)
      ? "mastered"
      : "learning";

    // A species is "blocked" when exactly one leg is mastered and the other
    // is not. The forceAllMastered branch above always produces "mastered" for
    // both legs so isBlocked will always be false in that mode.
    const nameMastered = nameLeg === "mastered";
    const reverseMastered = reverseLeg === "mastered";
    const isBlocked = !forceAllMastered && (nameMastered !== reverseMastered);

    const blockingLeg: "name" | "reverse" | null = isBlocked
      ? nameMastered
        ? "reverse"
        : "name"
      : null;

    result.set(speciesId, {
      speciesId,
      name: nameLeg,
      reverse: reverseLeg,
      isBlocked,
      blockingLeg,
    });
  }

  return result;
}
