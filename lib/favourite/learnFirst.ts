/**
 * "Learn <name>'s evolution line next?" (#2187): the species a Yes puts in
 * `priorityNewSpeciesIds`, and the synced record of which species the
 * question has already been asked for.
 */

import { deriveEvolutionFamilies } from "@/lib/evolution/chains";
import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";

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

/** True when the learn-first question was already asked for this species (on any device). */
export function wasLearnFirstAsked(speciesId: number): boolean {
  if (typeof window === "undefined") return false;
  return loadSettings().learnFirstAskedSpeciesIds.includes(speciesId);
}

/** Record that the learn-first question was asked for this species. */
export function markLearnFirstAsked(speciesId: number): void {
  if (typeof window === "undefined") return;
  const settings = loadSettings();
  if (settings.learnFirstAskedSpeciesIds.includes(speciesId)) return;
  saveSettings({
    ...settings,
    learnFirstAskedSpeciesIds: [...settings.learnFirstAskedSpeciesIds, speciesId],
  });
}
