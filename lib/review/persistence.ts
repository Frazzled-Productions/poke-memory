import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import { DEFAULT_LIMITS } from "@/lib/review/session";

export type { DailyLimits };

export type SavedSession = {
  cards: ReviewableCard[];
  limits: DailyLimits;
};

const STORAGE_KEY = "poke-memory:review-session:v1";

function isReviewCardShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "number" ||
    typeof v.name !== "string" ||
    typeof v.spriteUrl !== "string" ||
    typeof v.state !== "object" ||
    v.state === null ||
    typeof (v.state as Record<string, unknown>).dueDate !== "string"
  ) {
    return false;
  }
  if (v.cardType === "evolution") {
    return Array.isArray(v.evolvesIntoNames);
  }
  return true;
}

function isDailyLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  );
}

// Backfills missing state fields from localStorage. No-op on already-present
// fields. Migrations applied in order so older sessions pick up every missing
// field regardless of which version they last saved on:
//   1. firstSeen  — backfill from lastReview (added before learningStep)
//   2. learningStep — backfill to null (not in a step)
//   3. stepStartedAt — backfill to null
export function migrateReviewState(state: unknown): void {
  if (typeof state !== "object" || state === null) return;
  const s = state as Record<string, unknown>;
  if (s.firstSeen === undefined) {
    s.firstSeen = typeof s.lastReview === "string" ? s.lastReview : null;
  }
  if (s.learningStep === undefined) {
    s.learningStep = null;
  }
  if (s.stepStartedAt === undefined) {
    s.stepStartedAt = null;
  }
}

// Backfills cardType on legacy name cards and migrates state fields.
function migrateReviewCard(card: unknown): void {
  if (typeof card !== "object" || card === null) return;
  const c = card as Record<string, unknown>;
  if (c.cardType === undefined) {
    c.cardType = "name";
  }
  migrateReviewState(c.state);
}

export function loadSession(): SavedSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && !isReviewCardShaped(parsed[0])) {
        return null;
      }
      for (const card of parsed) {
        migrateReviewCard(card);
      }
      return {
        cards: parsed as ReviewableCard[],
        limits: DEFAULT_LIMITS,
      };
    }

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
          migrateReviewCard(card);
        }
        return {
          cards: obj.cards as ReviewableCard[],
          limits: obj.limits as DailyLimits,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
