import type { UserSettings } from "@/lib/settings/persistence";

/**
 * Maps `UserSettings.*CardsEnabled` toggles to the `opts` shape that
 * `buildSession` / `hydrateSession` expect. Centralises the mapping so the
 * fallback seeding paths (auth callback, manual sync brand-new-device,
 * pullAndMerge brand-new-device) cannot drift from each other and miss a
 * card-type toggle — the failure mode behind #391.
 */
export function seedOptsFromSettings(settings: UserSettings): {
  nameEnabled: boolean;
  evolutionEnabled: boolean;
  reverseEnabled: boolean;
  reverseEvolutionEnabled: boolean;
  cryEnabled: boolean;
} {
  return {
    nameEnabled: settings.nameCardsEnabled,
    evolutionEnabled: settings.evolutionCardsEnabled,
    reverseEnabled: settings.reverseCardsEnabled,
    reverseEvolutionEnabled: settings.reverseEvolutionCardsEnabled,
    cryEnabled: settings.cryCardsEnabled,
  };
}
