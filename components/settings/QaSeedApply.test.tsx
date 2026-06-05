/**
 * jsdom tests for lib/qa-seed/apply.ts.
 *
 * Lives under components/ (not lib/) because the test calls functions that
 * dispatch browser events and use IDB - both require the jsdom environment.
 * See AGENTS.md "Testing" section on test-file placement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySeedScenario, clearSeedScenario } from "@/lib/qa-seed/apply";

// ---------------------------------------------------------------------------
// localStorage stub
// ---------------------------------------------------------------------------

// jsdom on this Node version does not ship localStorage - install an in-memory
// stub, matching the pattern in CollapsibleSection.test.tsx.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIdbSet = vi.fn().mockResolvedValue(undefined);
const mockIdbDelete = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/idb/db", () => ({
  idbSet: (...args: unknown[]) => mockIdbSet(...args),
  idbDelete: (...args: unknown[]) => mockIdbDelete(...args),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ pokemonNameLocale: "en" })),
  saveSettings: vi.fn(),
}));

// apply.ts now also warms the streak + mastered-count caches; mock those
// side-effect helpers so the test stays focused on the seed orchestration.
vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/profile/masteredCountCache", () => ({
  writeMasteredCountForLocale: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

vi.mock("@/lib/storage/keys", () => ({
  KEY_REVIEW_SESSION: "poke-memory:review-session:v1",
  KEY_GRADE_LOG: "poke-memory:grade-log:v1",
  KEY_QA_SEED_ACTIVE: "poke-memory:qa-seed-active",
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applySeedScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls idbSet with the serialised session when payload.session is defined", async () => {
    const payload = {
      session: {
        cards: [{ cardType: "name" as const, id: 1, locale: "en", name: "Bulbasaur", spriteUrl: "/s/1.png", subjectKey: "species:1", state: { reps: 3, scheduledDays: 21, dueDate: "2026-06-01", fsrsState: "review" as const, stability: 50, difficulty: 4, elapsedDays: 21, lapses: 0, lastReview: "2026-05-10", firstSeen: "2026-04-01", learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: true } }],
        limits: {
          name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
          reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        },
      },
      pokemonNameLocale: null as null,
    };
    await applySeedScenario(payload);
    expect(mockIdbSet).toHaveBeenCalledWith(
      "poke-memory:review-session:v1",
      JSON.stringify(payload.session),
    );
  });

  it("does not call idbSet when payload.session is undefined", async () => {
    await applySeedScenario({ pokemonNameLocale: null });
    expect(mockIdbSet).not.toHaveBeenCalled();
  });

  it("calls saveSettings when pokemonNameLocale is non-null", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: "ja" });
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ pokemonNameLocale: "ja" }),
    );
  });

  it("does not call saveSettings when pokemonNameLocale is null", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: null });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("writes the active-seed slug to localStorage when slug is provided", async () => {
    // Install a localStorage stub for this test only - jsdom does not ship one.
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    await applySeedScenario({ pokemonNameLocale: null }, "mastery-gaps");
    expect(setItemSpy).toHaveBeenCalledWith("poke-memory:qa-seed-active", "mastery-gaps");
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("does not write the active-seed slug when no slug is provided", async () => {
    // Install a localStorage stub for this test only - jsdom does not ship one.
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    await applySeedScenario({ pokemonNameLocale: null });
    const activeCalls = setItemSpy.mock.calls.filter(
      ([key]) => key === "poke-memory:qa-seed-active",
    );
    expect(activeCalls.length).toBe(0);
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("dispatches a StorageEvent after writing session", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const payload = {
      session: {
        cards: [],
        limits: {
          name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
          reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        },
      },
      pokemonNameLocale: null as null,
    };
    await applySeedScenario(payload);
    expect(dispatchSpy).toHaveBeenCalled();
  });
});

describe("clearSeedScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the active-seed slug from localStorage", async () => {
    // Install a localStorage stub for this test only - jsdom does not ship one.
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    window.localStorage.setItem("poke-memory:qa-seed-active", "mastery-gaps");
    await clearSeedScenario();
    expect(window.localStorage.getItem("poke-memory:qa-seed-active")).toBeNull();
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("deletes the review session key from IDB", async () => {
    await clearSeedScenario();
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:review-session:v1");
  });

  it("deletes the grade log key from IDB", async () => {
    await clearSeedScenario();
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:grade-log:v1");
  });

  it("dispatches StorageEvents for both cleared keys", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    await clearSeedScenario();
    const storageEvents = dispatchSpy.mock.calls
      .map((args) => args[0])
      .filter((e) => e instanceof StorageEvent) as StorageEvent[];
    const keys = storageEvents.map((e) => e.key);
    expect(keys).toContain("poke-memory:review-session:v1");
    expect(keys).toContain("poke-memory:grade-log:v1");
  });
});
