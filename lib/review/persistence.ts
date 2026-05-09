import type { ReviewableCard, DailyLimits, PerTypeLimits } from "@/lib/review/session";
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
  // Reject unknown cardType values — undefined is allowed (legacy migration
  // backfills it to "name") but any explicit value other than "name" or
  // "evolution" indicates corruption or a forward-incompatible schema.
  if (
    v.cardType !== undefined &&
    v.cardType !== "name" &&
    v.cardType !== "evolution"
  ) {
    return false;
  }
  if (v.cardType === "evolution") {
    return (
      Array.isArray(v.evolvesIntoNames) &&
      v.evolvesIntoNames.every((n: unknown) => typeof n === "string")
    );
  }
  return true;
}

function isPerTypeLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  );
}

function isDailyLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // New shape: per-type limits.
  if (isPerTypeLimitsShaped(v.name) && isPerTypeLimitsShaped(v.evolution)) {
    return true;
  }
  // Legacy flat shape: { maxNewPerDay, maxReviewsPerDay }. Accepted for
  // migration; loadSession promotes it into the per-type shape on read.
  return (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  );
}

function migrateDailyLimits(raw: unknown): DailyLimits {
  if (typeof raw !== "object" || raw === null) return DEFAULT_LIMITS;
  const v = raw as Record<string, unknown>;
  if (isPerTypeLimitsShaped(v.name) && isPerTypeLimitsShaped(v.evolution)) {
    return {
      name: v.name as PerTypeLimits,
      evolution: v.evolution as PerTypeLimits,
    };
  }
  // Legacy flat shape — promote to name limits, evolution gets defaults.
  if (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  ) {
    return {
      name: {
        maxNewPerDay: v.maxNewPerDay,
        maxReviewsPerDay: v.maxReviewsPerDay,
      },
      evolution: { ...DEFAULT_LIMITS.evolution },
    };
  }
  return DEFAULT_LIMITS;
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

// Backfills cardType on legacy name cards and migrates state fields. Exported
// so unit tests can exercise the legacy-shape migration without needing a
// localStorage harness.
export function migrateReviewCard(card: unknown): void {
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
      if (!parsed.every(isReviewCardShaped)) {
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
        if (!obj.cards.every(isReviewCardShaped)) {
          return null;
        }
        for (const card of obj.cards) {
          migrateReviewCard(card);
        }
        return {
          cards: obj.cards as ReviewableCard[],
          limits: migrateDailyLimits(obj.limits),
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
