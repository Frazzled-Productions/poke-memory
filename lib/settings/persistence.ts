// localStorage key for all user-configurable settings
const STORAGE_KEY = "poke-memory:settings:v1";

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
