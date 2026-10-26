/**
 * The player's favourite Pokémon and hearted species (#2187).
 *
 * Pure helpers over `UserSettings`: callers load settings, apply a helper and
 * save the result. No seed import, so the settings parser and the push route
 * can use the parsers without pulling the seed JSON into their bundle.
 */

import type { UserSettings } from "@/lib/settings/persistence";
import { isSpeciesId } from "@/lib/pokemon/seed-constants";

/** A stored species id, or null when the value is not a species in the seed. */
export function parseSpeciesId(value: unknown): number | null {
  return isSpeciesId(value) ? value : null;
}

/**
 * A stored list of species ids: entries that are not species ids are dropped,
 * repeats are removed (first occurrence wins), and a non-array is empty.
 */
export function parseSpeciesIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    if (!isSpeciesId(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** True when the species is hearted. The favourite is always hearted. */
export function isHearted(settings: UserSettings, speciesId: number): boolean {
  return (
    settings.favouritePokemonId === speciesId ||
    settings.heartedSpeciesIds.includes(speciesId)
  );
}

/** `ids` with `speciesId` at the front and no repeat of it. */
function withAtFront(ids: readonly number[], speciesId: number): number[] {
  return [speciesId, ...ids.filter((id) => id !== speciesId)];
}

/**
 * Make `speciesId` the favourite (and heart it), or clear the favourite with
 * null. Clearing leaves the hearts alone, and changing the favourite keeps the
 * previous one hearted. The theme is never touched.
 */
export function setFavouritePokemon(
  settings: UserSettings,
  speciesId: number | null,
): UserSettings {
  if (speciesId === null) return { ...settings, favouritePokemonId: null };
  return {
    ...settings,
    favouritePokemonId: speciesId,
    heartedSpeciesIds: withAtFront(settings.heartedSpeciesIds, speciesId),
  };
}

/**
 * Heart a species (newest first) or un-heart it. The favourite cannot be
 * un-hearted while it is the favourite: toggling it leaves the list as is.
 */
export function toggleHeart(settings: UserSettings, speciesId: number): UserSettings {
  if (settings.favouritePokemonId === speciesId) return settings;
  const hearted = settings.heartedSpeciesIds.includes(speciesId);
  return {
    ...settings,
    heartedSpeciesIds: hearted
      ? settings.heartedSpeciesIds.filter((id) => id !== speciesId)
      : withAtFront(settings.heartedSpeciesIds, speciesId),
  };
}

/**
 * Settings after Reset progress (#2187): the theme, the learn-first list and
 * the colours-offer marker are progress-linked and cleared; the favourite and
 * the hearts are preferences and kept.
 */
export function settingsAfterProgressReset(settings: UserSettings): UserSettings {
  return {
    ...settings,
    favouriteTheme: null,
    priorityNewSpeciesIds: [],
    favouriteThemeOfferedForId: null,
  };
}
