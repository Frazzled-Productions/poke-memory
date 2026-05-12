import type { ThemeColors } from "@/lib/theme/curated-pokemon";

// localStorage key for all user-configurable settings
export const STORAGE_KEY = "poke-memory:settings:v1";

// Mirror of the structure stored under `favouriteTheme`. Validation of the
// values (HEX_COLOR / known Pokémon id) happens in lib/theme/persistence.ts
// — here we treat the field as an opaque container.
export type StoredFavouriteTheme = {
  id: number;
  name: string;
  colors: ThemeColors;
  spriteUrl: string | null;
};

export type UserSettings = {
  masteryRepetitions: number;        // cards with this many consecutive correct reviews = mastered
  maxNewPerDay: number;              // hard daily cap for new name cards
  maxReviewsPerDay: number;          // soft daily cap for name reviews
  maxNewEvolutionPerDay: number;     // hard daily cap for new evolution cards
  maxReviewsEvolutionPerDay: number; // soft daily cap for evolution reviews
  nameCardsEnabled: boolean;         // show sprite as prompt; type/select the name
  evolutionCardsEnabled: boolean;    // show sprite; identify evolution chain
  reverseCardsEnabled: boolean;      // show name as prompt; reveal sprite
  maxNewReversePerDay: number;       // hard daily cap for new reverse cards
  maxReviewsReversePerDay: number;   // soft daily cap for reverse reviews
  playCryOnReveal: boolean;          // play Pokémon cry audio on card reveal
  favouriteTheme: StoredFavouriteTheme | null; // chosen mastery accent Pokémon
};

export const DEFAULT_SETTINGS: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
  maxNewEvolutionPerDay: 5,
  maxReviewsEvolutionPerDay: 50,
  nameCardsEnabled: true,
  evolutionCardsEnabled: true,
  reverseCardsEnabled: false,
  maxNewReversePerDay: 10,
  maxReviewsReversePerDay: 100,
  playCryOnReveal: false,
  favouriteTheme: null,
};

// Returns DEFAULT_SETTINGS on fresh load, server, or corruption. Never throws.
// Legacy stored objects without the evolution-* keys are silently upgraded
// with the defaults — name-card limits keep their saved values.
export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const obj = parsed as Record<string, unknown>;
    return {
      masteryRepetitions:
        typeof obj.masteryRepetitions === "number"
          ? obj.masteryRepetitions
          : DEFAULT_SETTINGS.masteryRepetitions,
      maxNewPerDay:
        typeof obj.maxNewPerDay === "number"
          ? obj.maxNewPerDay
          : DEFAULT_SETTINGS.maxNewPerDay,
      maxReviewsPerDay:
        typeof obj.maxReviewsPerDay === "number"
          ? obj.maxReviewsPerDay
          : DEFAULT_SETTINGS.maxReviewsPerDay,
      maxNewEvolutionPerDay:
        typeof obj.maxNewEvolutionPerDay === "number"
          ? obj.maxNewEvolutionPerDay
          : DEFAULT_SETTINGS.maxNewEvolutionPerDay,
      maxReviewsEvolutionPerDay:
        typeof obj.maxReviewsEvolutionPerDay === "number"
          ? obj.maxReviewsEvolutionPerDay
          : DEFAULT_SETTINGS.maxReviewsEvolutionPerDay,
      nameCardsEnabled:
        typeof obj.nameCardsEnabled === "boolean"
          ? obj.nameCardsEnabled
          : DEFAULT_SETTINGS.nameCardsEnabled,
      evolutionCardsEnabled:
        typeof obj.evolutionCardsEnabled === "boolean"
          ? obj.evolutionCardsEnabled
          : DEFAULT_SETTINGS.evolutionCardsEnabled,
      reverseCardsEnabled:
        typeof obj.reverseCardsEnabled === "boolean"
          ? obj.reverseCardsEnabled
          : DEFAULT_SETTINGS.reverseCardsEnabled,
      maxNewReversePerDay:
        typeof obj.maxNewReversePerDay === "number"
          ? obj.maxNewReversePerDay
          : DEFAULT_SETTINGS.maxNewReversePerDay,
      maxReviewsReversePerDay:
        typeof obj.maxReviewsReversePerDay === "number"
          ? obj.maxReviewsReversePerDay
          : DEFAULT_SETTINGS.maxReviewsReversePerDay,
      playCryOnReveal:
        typeof obj.playCryOnReveal === "boolean"
          ? obj.playCryOnReveal
          : DEFAULT_SETTINGS.playCryOnReveal,
      // Shallow validation only — lib/theme/persistence.ts does the deep
      // validation (HEX_COLOR, known Pokémon id) on read.
      favouriteTheme:
        typeof obj.favouriteTheme === "object" && obj.favouriteTheme !== null
          ? (obj.favouriteTheme as StoredFavouriteTheme)
          : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Serialises to localStorage. No-op on server. Never throws.
export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// True if a settings blob has been explicitly written. loadSettings cannot
// distinguish "never written" from "written with defaults" — sync logic needs
// this to know whether a pulled cloud value should overlay local defaults.
export function hasStoredSettings(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}
