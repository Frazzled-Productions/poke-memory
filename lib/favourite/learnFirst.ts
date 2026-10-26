/**
 * "Learn <name>'s evolution line next?" (#2187): the species a Yes puts in
 * `priorityNewSpeciesIds`, and the device-local record of which species the
 * question has already been asked for.
 */

import { deriveEvolutionFamilies } from "@/lib/evolution/chains";
import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";
import { KEY_LEARN_FIRST_ASKED } from "@/lib/storage/keys";
import { parseSpeciesIdList } from "./favourite";

/**
 * The species in `speciesId`'s evolution family, in chain order, minus those
 * already introduced (a name card in the active locale with a `firstSeen`).
 * A species with no evolutions is its own line.
 */
export function learnFirstSpeciesIds(
  speciesId: number,
  cards: readonly ReviewableCard[],
  activeLocale: AppLocale,
): number[] {
  const family = deriveEvolutionFamilies(cards).find((f) =>
    f.nodes.some((n) => n.speciesId === speciesId),
  );
  const line = family ? family.nodes.map((n) => n.speciesId) : [speciesId];
  const introduced = new Set(
    cards
      .filter(
        (c) =>
          c.cardType === "name" &&
          (c.locale ?? "en") === activeLocale &&
          c.state.firstSeen !== null,
      )
      .map((c) => c.id),
  );
  return line.filter((id) => !introduced.has(id));
}

/** True when the learn-first question was already asked for this species on this device. */
export function wasLearnFirstAsked(speciesId: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(KEY_LEARN_FIRST_ASKED);
    return raw !== null && parseSpeciesIdList(JSON.parse(raw)).includes(speciesId);
  } catch {
    return false;
  }
}

/** Record that the learn-first question was asked for this species. */
export function markLearnFirstAsked(speciesId: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY_LEARN_FIRST_ASKED);
    const asked = raw === null ? [] : parseSpeciesIdList(JSON.parse(raw));
    if (asked.includes(speciesId)) return;
    window.localStorage.setItem(KEY_LEARN_FIRST_ASKED, JSON.stringify([...asked, speciesId]));
  } catch {
    // private browsing or storage full: the question may be asked again
  }
}
