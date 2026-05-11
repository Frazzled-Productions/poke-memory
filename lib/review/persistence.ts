import type { ReviewableCard, ReverseReviewCard, DailyLimits, PerTypeLimits } from "@/lib/review/session";
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
  // backfills it to "name") but any explicit value other than "name",
  // "evolution", or "reverse" indicates corruption or a forward-incompatible schema.
  if (
    v.cardType !== undefined &&
    v.cardType !== "name" &&
    v.cardType !== "evolution" &&
    v.cardType !== "reverse"
  ) {
    return false;
  }
  if (v.cardType === "evolution") {
    // Accept new shape: evolvesInto: { name: string; spriteUrl: string }[]
    if (
      Array.isArray(v.evolvesInto) &&
      v.evolvesInto.every(
        (e: unknown) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).name === "string" &&
          typeof (e as Record<string, unknown>).spriteUrl === "string",
      )
    ) {
      return true;
    }
    // Accept legacy shape: evolvesIntoNames: string[] (backwards compat window)
    if (
      Array.isArray(v.evolvesIntoNames) &&
      v.evolvesIntoNames.every((n: unknown) => typeof n === "string")
    ) {
      return true;
    }
    return false;
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
  // Current shape: per-type limits. `reverse` is optional for existing sessions.
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
      // `reverse` is optional in persisted sessions; backfill with default.
      reverse: isPerTypeLimitsShaped(v.reverse)
        ? (v.reverse as PerTypeLimits)
        : { ...DEFAULT_LIMITS.reverse },
    };
  }
  // Legacy flat shape — promote to name limits, evolution + reverse get defaults.
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
      reverse: { ...DEFAULT_LIMITS.reverse },
    };
  }
  return DEFAULT_LIMITS;
}

// Backfills missing state fields from localStorage. No-op on already-present
// fields. Migrations applied in order so older sessions pick up every missing
// field regardless of which version they last saved on:
//   1. firstSeen  — backfill from lastReview (added before learningStep)
//   2. learningStep — backfill to null (not in a step)
//   3. stepStartedAt — concrete timestamp for in-learning cards, null for graduated cards
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
    // Cards in a learning step get a concrete start time so the mount-time queue
    // builder can compute a real countdown; graduated cards keep null.
    s.stepStartedAt = s.learningStep !== null ? Date.now() : null;
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
  // Migrate old evolvesIntoNames: string[] → evolvesInto: { name, spriteUrl }[].
  // hydrateSession re-populates evolvesInto from seed; [] is a safe placeholder
  // that prevents component crashes when no seed match exists.
  if (c.cardType === "evolution") {
    const hasValidEvolvesInto =
      Array.isArray(c.evolvesInto) &&
      c.evolvesInto.every(
        (e: unknown) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).name === "string" &&
          typeof (e as Record<string, unknown>).spriteUrl === "string",
      );
    if (!hasValidEvolvesInto) {
      c.evolvesInto = [];
    }
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

// Strips large seed-derived arrays from reverse cards before serialization.
// hydrateSession re-injects them from the seed on every mount, so persisting
// them wastes quota (~4.5 MB → ~2.9 MB with ~1025 reverse cards).
function serializeCard(card: ReviewableCard): unknown {
  if (card.cardType !== "reverse") return card;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { flavorTexts: _ft, evolutionChain: _ec, ...rest } = card as ReverseReviewCard & Record<string, unknown>;
  return rest;
}

export type SaveResult = { ok: true } | { ok: false; reason: "quota" | "unknown" };

export function saveSession(session: SavedSession): SaveResult {
  if (typeof window === "undefined") return { ok: true };

  const payload = { cards: session.cards.map(serializeCard), limits: session.limits };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.code === 22)
    ) {
      console.warn("[poke-memory] saveSession: localStorage quota exceeded", err);
      return { ok: false, reason: "quota" };
    }
    console.warn("[poke-memory] saveSession: localStorage write failed", err);
    return { ok: false, reason: "unknown" };
  }
}
