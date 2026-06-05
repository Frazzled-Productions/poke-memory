import type { UserSettings } from "@/lib/settings/persistence";
import type { AppLocale } from "@/i18n/locales";

/**
 * Maps `UserSettings.*CardsEnabled` toggles to the `opts` shape that
 * `buildSession` / `hydrateSession` expect. Centralises the mapping so the
 * fallback seeding paths (auth callback, manual sync brand-new-device,
 * pullAndMerge brand-new-device) cannot drift from each other and miss a
 * card-type toggle - the failure mode behind #391.
 *
 * Name and reverse are always on since #1234. Only the opt-in enrichment
 * directions (evolution, reverse-evolution, cry) are read from settings.
 *
 * Also carries `locale` from `settings.pokemonNameLocale` so every build/
 * hydrate path stamps the correct locale onto new cards (#1259).
 */
export function seedOptsFromSettings(settings: UserSettings): {
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  reverseEvolutionEnabled: boolean;
  cryEnabled: boolean;
  locale: AppLocale;
} {
  return {
    nameEnabled: true,
    evolutionEnabled: settings.evolutionCardsEnabled,
    reverseEnabled: true,
    reverseEvolutionEnabled: settings.reverseEvolutionCardsEnabled,
    cryEnabled: settings.cryCardsEnabled,
    locale: settings.pokemonNameLocale,
  };
}
