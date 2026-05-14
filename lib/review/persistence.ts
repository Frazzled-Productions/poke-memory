import type { ReviewableCard, DailyLimits, PerTypeLimits } from "@/lib/review/session";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { Subject } from "@/lib/cards/subjectKey";
import { idbGet, idbSet, isIdbAvailable } from "@/lib/idb/db";

export type { DailyLimits };

export type SavedSession = {
  cards: ReviewableCard[];
  limits: DailyLimits;
};

export const STORAGE_KEY = "poke-memory:review-session:v1";

function isReviewCardShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "number") return false;
  if (typeof v.state !== "object" || v.state === null) return false;
  if (typeof (v.state as Record<string, unknown>).dueDate !== "string") return false;
  // Reject unknown cardType values — undefined is allowed (legacy migration
  // backfills it to "name") but any explicit value other than the known
  // discriminants indicates corruption or a forward-incompatible schema.
  if (
    v.cardType !== undefined &&
    v.cardType !== "name" &&
    v.cardType !== "evolution" &&
    v.cardType !== "reverse-evolution" &&
    v.cardType !== "reverse" &&
    v.cardType !== "cry"
  ) {
    return false;
  }
  if (v.cardType === "evolution") {
    // New edge shape (#262): postEvoId-keyed. Other edge fields are refreshed
    // from seed on hydrate, so they're not validated here.
    if (typeof v.postEvoId === "number") return true;
    // Legacy per-pre-evo shapes (evolvesInto or evolvesIntoNames). Accepted
    // here so the whole session still validates; isLegacyEvolutionCard()
    // filters them out before hydration — there's no 1:N mapping from a
    // legacy card to the new edge cards (#262 plan, resolved decision 2).
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
    if (
      Array.isArray(v.evolvesIntoNames) &&
      v.evolvesIntoNames.every((n: unknown) => typeof n === "string")
    ) {
      return true;
    }
    return false;
  }
  if (v.cardType === "reverse-evolution") {
    // Edge card derived 1:1 from a forward EvolutionCard (#343). Shares the
    // postEvoId-keyed shape and is refreshed from seed on hydrate — no
    // name/spriteUrl is ever serialised for edge cards.
    return typeof v.preEvoId === "number" && typeof v.postEvoId === "number";
  }
  // Non-evolution cards still need name + spriteUrl present so the legacy
  // migration path can backfill cardType="name" safely.
  if (typeof v.name !== "string") return false;
  if (typeof v.spriteUrl !== "string") return false;
  return true;
}

// True when an evolution card is in either of the legacy per-pre-evo shapes
// retired by #262. Used to drop these from the loaded session on first read
// post-upgrade.
function isLegacyEvolutionCard(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.cardType !== "evolution") return false;
  return typeof v.postEvoId !== "number";
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
      // `reverse` and `cry` are optional in persisted sessions; backfill with defaults.
      reverse: isPerTypeLimitsShaped(v.reverse)
        ? (v.reverse as PerTypeLimits)
        : { ...DEFAULT_LIMITS.reverse },
      cry: isPerTypeLimitsShaped(v.cry)
        ? (v.cry as PerTypeLimits)
        : { ...DEFAULT_LIMITS.cry },
    };
  }
  // Legacy flat shape — promote to name limits, the rest get defaults.
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
      cry: { ...DEFAULT_LIMITS.cry },
    };
  }
  return DEFAULT_LIMITS;
}

// Backfills missing state fields from localStorage. No-op on already-present
// fields. Migrations applied in order so older sessions pick up every missing
// field regardless of which version they last saved on:
//   1. firstSeen     — backfill from lastReview (added before learningStep)
//   2. learningStep  — backfill to null (not in a step)
//   3. stepStartedAt — concrete timestamp for in-learning cards, null for graduated cards
//   4. SM-2 → FSRS — if `stability` is missing, derive FSRS fields from the
//      old SM-2 fields (repetitions / interval / easeFactor) and remove them.
//      Mirrors the formula in #263.
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
  if (s.hiddenSince === undefined) {
    // Backfill for sessions saved before #333. Null means "currently eligible
    // under the filter" — the reconciliation step on next load will set it
    // forward when applicable.
    s.hiddenSince = null;
  }
  if (typeof s.seenInPasture !== "boolean") {
    // Backfill for sessions saved before #350. Existing mastered cards have
    // not yet been acknowledged in the pasture — default to false so they
    // appear as "new arrivals" the first time the pasture page is visited.
    s.seenInPasture = false;
  }
  if (s.stability === undefined) {
    const repetitions = typeof s.repetitions === "number" ? s.repetitions : 0;
    const interval = typeof s.interval === "number" ? s.interval : 0;
    const easeFactor = typeof s.easeFactor === "number" ? s.easeFactor : 2.5;
    const lastReview = typeof s.lastReview === "string" ? s.lastReview : null;
    const isGraduated = repetitions > 0 || lastReview !== null;
    if (isGraduated) {
      s.stability = Math.max(1, interval);
      // Invert SM-2 ease (1.3..2.5) onto FSRS difficulty (10..1). Lower ease
      // means harder; FSRS difficulty 10 is hardest.
      const raw = 10 - (9 * (easeFactor - 1.3)) / 1.2;
      s.difficulty = Math.min(10, Math.max(1, raw));
      s.elapsedDays = 0;
      s.scheduledDays = interval;
      s.reps = repetitions;
      s.lapses = 0;
      s.fsrsState = "review";
    } else {
      s.stability = 0;
      s.difficulty = 0;
      s.elapsedDays = 0;
      s.scheduledDays = 0;
      s.reps = 0;
      s.lapses = 0;
      s.fsrsState = "new";
    }
    delete s.repetitions;
    delete s.interval;
    delete s.easeFactor;
  }
}

// Backfills cardType on legacy name cards, backfills subjectKey for all card
// types that lack it, and migrates state fields. Exported so unit tests can
// exercise the legacy-shape migration without needing a localStorage harness.
//
// Legacy evolution cards (#262 retired the per-pre-evo shape): no migration
// is attempted here — they're filtered out at session-load time by
// isLegacyEvolutionCard() because there's no 1:N mapping to the new edge
// cards. This function is a no-op for them.
export function migrateReviewCard(card: unknown): void {
  if (typeof card !== "object" || card === null) return;
  const c = card as Record<string, unknown>;
  if (c.cardType === undefined) {
    c.cardType = "name";
  }
  // Backfill subjectKey for cards saved before migration 010. This runs once
  // per device on the first loadSession after deploy; subsequent saves will
  // include the field.
  if (c.subjectKey === undefined) {
    const cardType = c.cardType as string;
    if (cardType === "name") {
      if (typeof c.id === "number" && c.id > 0) {
        try { c.subjectKey = Subject.forSpecies(c.id); } catch { /* leave undefined */ }
      }
    } else if (cardType === "reverse") {
      // reverse card: pokemonId is the species id
      const pokemonId = typeof c.pokemonId === "number" ? c.pokemonId : null;
      if (pokemonId !== null && pokemonId > 0) {
        try { c.subjectKey = Subject.forSpecies(pokemonId); } catch { /* leave undefined */ }
      }
    } else if (cardType === "cry") {
      const pokemonId = typeof c.pokemonId === "number" ? c.pokemonId : null;
      if (pokemonId !== null && pokemonId > 0) {
        try { c.subjectKey = Subject.forSpecies(pokemonId); } catch { /* leave undefined */ }
      }
    } else if (cardType === "evolution" || cardType === "reverse-evolution") {
      // Edge cards: derive from preEvoId/postEvoId when present.
      const preEvoId = typeof c.preEvoId === "number" ? c.preEvoId : null;
      const postEvoId = typeof c.postEvoId === "number" ? c.postEvoId : null;
      if (preEvoId !== null && postEvoId !== null) {
        try { c.subjectKey = Subject.forEdge(preEvoId, postEvoId); } catch { /* leave undefined */ }
      }
    }
  }
  migrateReviewState(c.state);
}

function parseSession(raw: string): SavedSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      if (!parsed.every(isReviewCardShaped)) {
        return null;
      }
      for (const card of parsed) {
        migrateReviewCard(card);
      }
      const filtered = parsed.filter((c) => !isLegacyEvolutionCard(c));
      return {
        cards: filtered as ReviewableCard[],
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
        const filtered = obj.cards.filter((c) => !isLegacyEvolutionCard(c));
        return {
          cards: filtered as ReviewableCard[],
          limits: migrateDailyLimits(obj.limits),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Synchronous localStorage fallback used when IndexedDB is unavailable.
function loadSessionLS(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseSession(raw);
  } catch {
    return null;
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  if (typeof window === "undefined") return null;

  if (!isIdbAvailable()) {
    return loadSessionLS();
  }

  try {
    const raw = await idbGet(STORAGE_KEY);
    if (raw === null) {
      // IDB had nothing — check localStorage as a last resort (covers the
      // window between migration running and a fresh install).
      return loadSessionLS();
    }
    return parseSession(raw);
  } catch {
    return loadSessionLS();
  }
}

// Strips large seed-derived arrays from name and reverse cards before
// serialization. hydrateSession re-injects them from the seed on every mount,
// so persisting them wastes quota and can fill localStorage on mobile.
function serializeCard(card: ReviewableCard): unknown {
  if (card.cardType === "name" || card.cardType === "reverse") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { flavorTexts: _ft, evolutionChain: _ec, ...rest } = card as Record<string, unknown>;
    return rest;
  }
  return card;
}

export type SaveResult = { ok: true } | { ok: false; reason: "quota" | "unknown" };

// Synchronous localStorage fallback used when IndexedDB is unavailable.
function saveSessionLS(session: SavedSession): SaveResult {
  if (typeof window === "undefined") return { ok: true };
  const payload = { cards: session.cards.map(serializeCard), limits: session.limits };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
  return { ok: true };
}

function dispatchStorageEvent(): void {
  // Same-tab subscribers (useSessionStorageKey) require a synthetic StorageEvent
  // to re-render. The browser only fires the native event in *other* tabs.
  // Even though data now lives in IndexedDB rather than localStorage, browsers
  // don't validate storageArea when you construct a StorageEvent yourself, so
  // the dispatch still reaches all window.addEventListener("storage", …) handlers
  // on the same tab. Centralising the dispatch here means every writer satisfies
  // the invariant without remembering it explicitly.
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        storageArea: window.localStorage,
        newValue: null,
      }),
    );
  } catch {
    // Older browsers / non-standard envs without a StorageEvent constructor.
  }
}

export async function saveSession(session: SavedSession): Promise<SaveResult> {
  if (typeof window === "undefined") return { ok: true };

  const payload = { cards: session.cards.map(serializeCard), limits: session.limits };
  const json = JSON.stringify(payload);

  if (!isIdbAvailable()) {
    const result = saveSessionLS(session);
    if (result.ok) {
      dispatchStorageEvent();
    }
    return result;
  }

  await idbSet(STORAGE_KEY, json);

  // idbSet swallows internal errors without throwing — it just flips
  // idbAvailable to false. Check after the await so a silently-failed write
  // falls back to localStorage instead of returning a false-positive ok.
  if (!isIdbAvailable()) {
    const result = saveSessionLS(session);
    if (result.ok) {
      dispatchStorageEvent();
    }
    return result;
  }

  dispatchStorageEvent();
  return { ok: true };
}
