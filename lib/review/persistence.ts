import type { ReviewCard } from "@/lib/review/session";

const STORAGE_KEY = "poke-memory:review-session:v1";

// Returns null if no saved session exists or if called on the server.
// Returns a hydrated ReviewCard[] otherwise.
// Catches JSON parse errors and returns null (treats corrupted state as no state).
export function loadSession(): ReviewCard[] | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Spot-check the first record's shape so a schema drift (e.g. cards
    // saved by an older app version) is treated as no state, not silently
    // returned with `undefined` fields that crash the scheduler.
    if (parsed.length > 0) {
      const first = parsed[0];
      if (
        typeof first?.id !== "number" ||
        typeof first?.name !== "string" ||
        typeof first?.spriteUrl !== "string" ||
        typeof first?.state?.dueDate !== "string"
      ) {
        return null;
      }
    }
    return parsed as ReviewCard[];
  } catch {
    return null;
  }
}

// Serialises and writes the session to localStorage. No-op on the server.
export function saveSession(cards: readonly ReviewCard[]): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}
