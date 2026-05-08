// localStorage key for all user-configurable settings
const STORAGE_KEY = "poke-memory:settings:v1";

export type UserSettings = {
  masteryRepetitions: number;  // cards with this many consecutive correct reviews = mastered
  maxNewPerDay: number;        // hard daily cap for new cards
  maxReviewsPerDay: number;    // soft daily cap for review cards
};

export const DEFAULT_SETTINGS: UserSettings = {
  masteryRepetitions: 3,
  maxNewPerDay: 10,
  maxReviewsPerDay: 100,
};

// Returns DEFAULT_SETTINGS on fresh load, server, or corruption. Never throws.
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
