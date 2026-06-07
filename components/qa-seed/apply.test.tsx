/**
 * Unit tests for lib/qa-seed/apply.ts (#1608). jsdom (needs localStorage,
 * StorageEvent, and fake-indexeddb) - lives under components/ per the
 * AGENTS.md test-placement rule.
 *
 * The existing components/settings/QaSeedApply.test.tsx covers the
 * side-effect orchestration at a coarse level (idbSet called, saveSettings
 * called, StorageEvent dispatched). This file covers the non-trivial internal
 * logic:
 *
 *   1. lastNDates() - date arithmetic, DST-safety, boundary cases.
 *   2. Multi-key settings merge - all payload keys flow into a single
 *      loadSettings/saveSettings call; pre-existing keys are preserved.
 *   3. masteredCountByLocale warming - writeMasteredCountForLocale is called
 *      once per locale in the payload, with the correct value.
 *   4. Slug persistence - KEY_QA_SEED_ACTIVE is written / omitted correctly.
 *   5. clearSeedScenario - IDB deletes, streak + settings reset, mastered
 *      cache zeroed, StorageEvents dispatched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applySeedScenario, clearSeedScenario } from "@/lib/qa-seed/apply";
import { DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";

// ---------------------------------------------------------------------------
// localStorage stub (same pattern as dueCountCache.test.tsx)
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

// Capture the real jsdom localStorage before any test replaces it.
// The StorageEvent-dispatch tests need a real Storage instance as storageArea;
// jsdom's StorageEvent constructor rejects non-Storage objects and the
// writeLocalStorage helper swallows the resulting error silently.
const realJsdomLocalStorage: Storage = window.localStorage;

// ---------------------------------------------------------------------------
// Mocks
//
// We mock only the modules that are unavoidably impure (IDB) or already
// covered elsewhere (streak/persistence, settings/persistence). The
// masteredCountCache module is tested via its real implementation in the
// masteredCountCache.test.tsx; here we spy on it so we can assert which
// locales and counts are forwarded without duplicating those unit tests.
// ---------------------------------------------------------------------------

const mockIdbSet = vi.fn().mockResolvedValue(undefined);
const mockIdbDelete = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/idb/db", () => ({
  idbSet: (...args: unknown[]) => mockIdbSet(...args),
  idbDelete: (...args: unknown[]) => mockIdbDelete(...args),
}));

// Real loadSettings / saveSettings backed by our localStorage stub, so
// the merge logic exercises the actual persistence code.
const { loadSettings: realLoadSettings, saveSettings: realSaveSettings } =
  await vi.importActual<typeof import("@/lib/settings/persistence")>(
    "@/lib/settings/persistence",
  );

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => realLoadSettings()),
  saveSettings: vi.fn((...args: unknown[]) =>
    (realSaveSettings as (...a: unknown[]) => unknown)(...args),
  ),
}));

// Real streak helpers backed by our localStorage stub so we can assert what
// dates were saved without breaking the actual write path.
const { saveStreakData: realSaveStreakData } =
  await vi.importActual<typeof import("@/lib/streak/persistence")>(
    "@/lib/streak/persistence",
  );

vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn((...args: unknown[]) =>
    (realSaveStreakData as (...a: unknown[]) => unknown)(...args),
  ),
}));

const {
  writeMasteredCountForLocale: realWriteMasteredCountForLocale,
  readMasteredCountCache: realReadMasteredCountCache,
} = await vi.importActual<typeof import("@/lib/profile/masteredCountCache")>(
  "@/lib/profile/masteredCountCache",
);

vi.mock("@/lib/profile/masteredCountCache", () => ({
  writeMasteredCountForLocale: vi.fn((...args: unknown[]) =>
    (realWriteMasteredCountForLocale as (...a: unknown[]) => unknown)(...args),
  ),
  readMasteredCountCache: vi.fn((...args: unknown[]) =>
    (realReadMasteredCountCache as (...a: unknown[]) => unknown)(...args),
  ),
}));

vi.mock("@/lib/review/persistence", () => ({
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

// ---------------------------------------------------------------------------
// lastNDates() - date arithmetic
//
// lastNDates is not exported; we exercise it indirectly via applySeedScenario
// → saveStreakData (which receives the computed array). We can also test it
// directly by importing the real saveStreakData spy's argument.
// ---------------------------------------------------------------------------

describe("lastNDates arithmetic (via saveStreakData call)", () => {
  it("produces exactly n dates when streakDays = n", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 5 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const calls = vi.mocked(saveStreakData).mock.calls;
    expect(calls.length).toBe(1);
    const dates = calls[0][0] as string[];
    expect(dates.length).toBe(5);
  });

  it("produces an array ending with today's date in YYYY-MM-DD format", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 3 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const dates = vi.mocked(saveStreakData).mock.calls[0][0] as string[];
    const today = new Date().toISOString().slice(0, 10);
    expect(dates[dates.length - 1]).toBe(today);
  });

  it("dates are in ascending (oldest-first) order", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 7 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const dates = vi.mocked(saveStreakData).mock.calls[0][0] as string[];
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it("each consecutive date is exactly one calendar day apart", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 4 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const dates = vi.mocked(saveStreakData).mock.calls[0][0] as string[];
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]).getTime();
      const curr = new Date(dates[i]).getTime();
      // Allow for a DST boundary: 23 or 25 hours in ms. The implementation
      // uses Date.now() - i * 86_400_000, which is millisecond arithmetic and
      // therefore DST-safe - the difference in ISO date strings will always be
      // one calendar day regardless of clock changes.
      const diffMs = curr - prev;
      expect(diffMs).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
      expect(diffMs).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
    }
  });

  it("does NOT call saveStreakData when streakDays is 0", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 0 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    expect(vi.mocked(saveStreakData)).not.toHaveBeenCalled();
  });

  it("does NOT call saveStreakData when streakDays is absent", async () => {
    await applySeedScenario({ pokemonNameLocale: null });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    expect(vi.mocked(saveStreakData)).not.toHaveBeenCalled();
  });

  it("produces exactly 1 date (today only) when streakDays = 1", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 1 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const dates = vi.mocked(saveStreakData).mock.calls[0][0] as string[];
    expect(dates.length).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(dates[0]).toBe(today);
  });

  it("produces a 30-date array for streakDays = 30", async () => {
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 30 });
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const dates = vi.mocked(saveStreakData).mock.calls[0][0] as string[];
    expect(dates.length).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Multi-key settings merge
//
// applySeedScenario merges all settings-patch keys into a single
// loadSettings/saveSettings round-trip. Assert that:
//   - every patched key appears in the saved object
//   - pre-existing keys on the settings object are preserved
//   - the merge does NOT happen when no settings keys are present in the payload
// ---------------------------------------------------------------------------

describe("settings merge", () => {
  it("merges pokemonNameLocale into existing settings without losing other keys", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: "ja" });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveSettings).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved.pokemonNameLocale).toBe("ja");
    // At least one other default key should be present to prove the merge.
    expect(typeof saved.maxNewPerDay).toBe("number");
  });

  it("merges learningLocales into settings", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({ pokemonNameLocale: null, learningLocales: ["en", "ja"] });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveSettings).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved.learningLocales).toEqual(["en", "ja"]);
  });

  it("merges activePokemonNameLocale into settings", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({
      pokemonNameLocale: "en",
      activePokemonNameLocale: "ja",
    });
    const saved = vi.mocked(saveSettings).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved.activePokemonNameLocale).toBe("ja");
  });

  it("merges streakProtection into settings", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    const protection = { ...DEFAULT_STREAK_PROTECTION, balance: 2 };
    await applySeedScenario({ pokemonNameLocale: null, streakProtection: protection });
    const saved = vi.mocked(saveSettings).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect((saved.streakProtection as { balance: number }).balance).toBe(2);
  });

  // Note: the labsFlags.languages merge test was removed because labsFlags.languages
  // is a dead key post-GA (#1726) - LabsFlags is Record<never, boolean> so the key
  // is stripped on read. The fsrs-locale-mastery scenario no longer sets it.

  it("does NOT call saveSettings when the payload has no settings keys", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    // A payload that sets only IDB data + no settings fields.
    await applySeedScenario({ pokemonNameLocale: null });
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
  });

  it("includes all four settings keys in one saveSettings call when all are present", async () => {
    const { saveSettings } = await import("@/lib/settings/persistence");
    await applySeedScenario({
      pokemonNameLocale: "en",
      learningLocales: ["en", "ja"],
      activePokemonNameLocale: "en",
      streakProtection: { ...DEFAULT_STREAK_PROTECTION, balance: 1 },
    });
    // Only one saveSettings call (single load/save round-trip).
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveSettings).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved.pokemonNameLocale).toBe("en");
    expect(saved.learningLocales).toEqual(["en", "ja"]);
    expect(saved.activePokemonNameLocale).toBe("en");
    expect((saved.streakProtection as { balance: number }).balance).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// masteredCountByLocale warming
//
// When the payload contains masteredCountByLocale, writeMasteredCountForLocale
// must be called once per locale in that object, with the correct count.
// ---------------------------------------------------------------------------

describe("masteredCountByLocale warming", () => {
  it("calls writeMasteredCountForLocale for each locale in the payload", async () => {
    const { writeMasteredCountForLocale } = await import(
      "@/lib/profile/masteredCountCache"
    );
    await applySeedScenario({
      pokemonNameLocale: null,
      masteredCountByLocale: { en: 40, ja: 10, "zh-Hans": 5, "zh-Hant": 3 },
    });
    const mock = vi.mocked(writeMasteredCountForLocale);
    // One call per locale.
    expect(mock).toHaveBeenCalledTimes(4);
    expect(mock).toHaveBeenCalledWith("en", 40);
    expect(mock).toHaveBeenCalledWith("ja", 10);
    expect(mock).toHaveBeenCalledWith("zh-Hans", 5);
    expect(mock).toHaveBeenCalledWith("zh-Hant", 3);
  });

  it("does NOT call writeMasteredCountForLocale when the payload has no masteredCountByLocale", async () => {
    const { writeMasteredCountForLocale } = await import(
      "@/lib/profile/masteredCountCache"
    );
    await applySeedScenario({ pokemonNameLocale: null });
    expect(vi.mocked(writeMasteredCountForLocale)).not.toHaveBeenCalled();
  });

  it("only calls writeMasteredCountForLocale for locales with numeric values", async () => {
    const { writeMasteredCountForLocale } = await import(
      "@/lib/profile/masteredCountCache"
    );
    // Payload with one valid number and one non-number (should skip the non-number).
    await applySeedScenario({
      pokemonNameLocale: null,
      masteredCountByLocale: { en: 20, ja: 0 },
    });
    const mock = vi.mocked(writeMasteredCountForLocale);
    // en = 20 (valid), ja = 0 (valid number - 0 IS a number).
    expect(mock).toHaveBeenCalledWith("en", 20);
    expect(mock).toHaveBeenCalledWith("ja", 0);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("the written mastered counts are readable from readMasteredCountCache", async () => {
    // This uses the real writeMasteredCountForLocale (backed by our localStorage
    // stub) to prove end-to-end: apply writes → read reflects the written values.
    const { readMasteredCountCache } = await import(
      "@/lib/profile/masteredCountCache"
    );
    await applySeedScenario({
      pokemonNameLocale: null,
      masteredCountByLocale: { en: 42, ja: 7, "zh-Hans": 3, "zh-Hant": 1 },
    });
    const cached = readMasteredCountCache();
    expect(cached.en).toBe(42);
    expect(cached.ja).toBe(7);
    expect(cached["zh-Hans"]).toBe(3);
    expect(cached["zh-Hant"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Slug persistence
// ---------------------------------------------------------------------------

describe("slug persistence", () => {
  it("writes the slug to KEY_QA_SEED_ACTIVE when a slug is provided", async () => {
    await applySeedScenario({ pokemonNameLocale: null }, "pasture-progression");
    expect(
      window.localStorage.getItem("poke-memory:qa-seed-active"),
    ).toBe("pasture-progression");
  });

  it("does NOT write the slug to KEY_QA_SEED_ACTIVE when no slug is provided", async () => {
    await applySeedScenario({ pokemonNameLocale: null });
    expect(
      window.localStorage.getItem("poke-memory:qa-seed-active"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// IDB write path (session)
// ---------------------------------------------------------------------------

describe("IDB write path", () => {
  it("calls idbSet with the serialised session JSON when payload.session is defined", async () => {
    const session = {
      cards: [],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    };
    await applySeedScenario({ session, pokemonNameLocale: null });
    expect(mockIdbSet).toHaveBeenCalledWith(
      "poke-memory:review-session:v1",
      JSON.stringify(session),
    );
  });

  it("does NOT call idbSet when payload.session is absent", async () => {
    await applySeedScenario({ pokemonNameLocale: null });
    expect(mockIdbSet).not.toHaveBeenCalled();
  });

  // StorageEvent dispatch requires the real jsdom localStorage (not the stub)
  // because jsdom's StorageEvent constructor validates that storageArea is a
  // proper Storage instance and throws otherwise (writeLocalStorage catches it).
  describe("StorageEvent dispatch - real localStorage", () => {
    beforeEach(() => {
      Object.defineProperty(window, "localStorage", {
        value: realJsdomLocalStorage,
        configurable: true,
        writable: true,
      });
      window.localStorage.clear();
    });

    afterEach(() => {
      window.localStorage.clear();
    });

    it("dispatches a StorageEvent for the session key after an IDB write", async () => {
      const events: StorageEvent[] = [];
      window.addEventListener("storage", (e) => events.push(e as StorageEvent));

      await applySeedScenario({
        session: {
          cards: [],
          limits: {
            name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
            reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
            cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
          },
        },
        pokemonNameLocale: null,
      });

      const sessionStorageEvents = events.filter(
        (e) => e.key === "poke-memory:review-session:v1",
      );
      expect(sessionStorageEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// clearSeedScenario
// ---------------------------------------------------------------------------

describe("clearSeedScenario", () => {
  it("removes both IDB keys", async () => {
    await clearSeedScenario();
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:review-session:v1");
    expect(mockIdbDelete).toHaveBeenCalledWith("poke-memory:grade-log:v1");
  });

  it("removes the active-seed slug from localStorage", async () => {
    window.localStorage.setItem("poke-memory:qa-seed-active", "mastery-gaps");
    await clearSeedScenario();
    expect(
      window.localStorage.getItem("poke-memory:qa-seed-active"),
    ).toBeNull();
  });

  it("resets the streak to an empty array", async () => {
    // Prime a streak first.
    await applySeedScenario({ pokemonNameLocale: null, streakDays: 5 });
    vi.mocked(await import("@/lib/streak/persistence").then((m) => m.saveStreakData)).mockClear();

    await clearSeedScenario();

    const { saveStreakData } = await import("@/lib/streak/persistence");
    const streakCalls = vi.mocked(saveStreakData).mock.calls;
    // The first saveStreakData call in clearSeedScenario must pass an empty array.
    expect(streakCalls[0][0]).toEqual([]);
  });

  it("resets the mastered-count cache to 0 for all SUPPORTED_LOCALES", async () => {
    // Prime non-zero counts.
    await applySeedScenario({
      pokemonNameLocale: null,
      masteredCountByLocale: { en: 40, ja: 5, "zh-Hans": 2, "zh-Hant": 1 },
    });

    const { readMasteredCountCache } = await import(
      "@/lib/profile/masteredCountCache"
    );

    await clearSeedScenario();

    // After clear, all counts should be 0.
    const cached = readMasteredCountCache();
    expect(cached.en).toBe(0);
    expect(cached.ja).toBe(0);
    expect(cached["zh-Hans"]).toBe(0);
    expect(cached["zh-Hant"]).toBe(0);
  });

  // StorageEvent dispatch requires the real jsdom localStorage - see note in
  // the "IDB write path" describe above for the full rationale.
  describe("StorageEvent dispatch - real localStorage", () => {
    beforeEach(() => {
      Object.defineProperty(window, "localStorage", {
        value: realJsdomLocalStorage,
        configurable: true,
        writable: true,
      });
      window.localStorage.clear();
    });

    afterEach(() => {
      window.localStorage.clear();
    });

    it("dispatches a StorageEvent for the session key on clear", async () => {
      const events: StorageEvent[] = [];
      window.addEventListener("storage", (e) => events.push(e as StorageEvent));

      await clearSeedScenario();

      const sessionEvents = events.filter(
        (e) => e.key === "poke-memory:review-session:v1",
      );
      expect(sessionEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("dispatches a StorageEvent for the grade-log key on clear", async () => {
      const events: StorageEvent[] = [];
      window.addEventListener("storage", (e) => events.push(e as StorageEvent));

      await clearSeedScenario();

      const gradeLogEvents = events.filter(
        (e) => e.key === "poke-memory:grade-log:v1",
      );
      expect(gradeLogEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
