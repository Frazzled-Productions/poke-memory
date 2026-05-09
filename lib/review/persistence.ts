import type { ReviewCard, DailyLimits } from "@/lib/review/session";
import { DEFAULT_LIMITS } from "@/lib/review/session";

export type { DailyLimits };

export type SavedSession = {
  cards: ReviewCard[];
  limits: DailyLimits;
  reviewedDates?: string[];
};

const STORAGE_KEY = "poke-memory:review-session:v1";

// Rough structural check for a single ReviewCard-shaped object.
function isReviewCardShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    typeof v.name === "string" &&
    typeof v.spriteUrl === "string" &&
    typeof v.state === "object" &&
    v.state !== null &&
    typeof (v.state as Record<string, unknown>).dueDate === "string"
  );
}

function isDailyLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  );
}

// Backfills missing fields on a plain card-state object parsed from localStorage.
// No-op on fields that are already present. If the state blob is corrupted
// (non-object), this is a no-op — the card will fail isReviewCardShaped
// downstream and the whole session will be rejected.
//
// Migrations applied in order:
//   1. `firstSeen` (introduced before learningStep): backfill from lastReview.
//   2. `learningStep` (new field): backfill to null (graduated / not in a step).
//   3. `stepStartedAt` (new field): backfill to null.
export function migrateReviewState(state: unknown): void {
  if (typeof state !== "object" || state === null) return;
  const s = state as Record<string, unknown>;
  // Migration 1: firstSeen
  if (s.firstSeen === undefined) {
    s.firstSeen = typeof s.lastReview === "string" ? s.lastReview : null;
  }
  // Migration 2: learningStep
  if (s.learningStep === undefined) {
    s.learningStep = null;
  }
  // Migration 3: stepStartedAt
  if (s.stepStartedAt === undefined) {
    s.stepStartedAt = null;
  }
}

// Returns null if no saved session exists, called on the server, or data is
// corrupted. Silently migrates legacy v1 format (bare ReviewCard[]) to the
// new SavedSession shape by wrapping it with DEFAULT_LIMITS.
export function loadSession(): SavedSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);

    // Legacy v1 shape: bare ReviewCard[]
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && !isReviewCardShaped(parsed[0])) {
        return null;
      }
      for (const card of parsed) {
        migrateReviewState((card as Record<string, unknown>).state);
      }
      return {
        cards: parsed as ReviewCard[],
        limits: DEFAULT_LIMITS,
      };
    }

    // New shape: { cards: ReviewCard[], limits: DailyLimits }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if (
        Array.isArray(obj.cards) &&
        isDailyLimitsShaped(obj.limits)
      ) {
        if (obj.cards.length > 0 && !isReviewCardShaped(obj.cards[0])) {
          return null;
        }
        for (const card of obj.cards) {
          migrateReviewState((card as Record<string, unknown>).state);
        }
        const reviewedDates = Array.isArray(obj.reviewedDates)
          ? (obj.reviewedDates as unknown[]).filter((d): d is string => typeof d === "string")
          : undefined;
        return {
          cards: obj.cards as ReviewCard[],
          limits: obj.limits as DailyLimits,
          ...(reviewedDates !== undefined && { reviewedDates }),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Serialises and writes the session to localStorage. No-op on the server.
export function saveSession(session: SavedSession): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
