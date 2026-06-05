/**
 * Tests for `lib/streak/runProtection`.
 *
 * The helper itself lives in `lib/`, but it touches localStorage via
 * `loadSettings`/`saveSettings` which need the jsdom polyfill stub the rest
 * of the component tests use. Co-locating the test under `components/` puts
 * it into the jsdom project (see AGENTS.md "Testing").
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runStreakProtection } from "@/lib/streak/runProtection";
import {
  loadSettings,
  saveSettings,
  STORAGE_KEY,
} from "@/lib/settings/persistence";
import { saveStreakData } from "@/lib/streak/persistence";
import { EARN_INTERVAL_DAYS, DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";

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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

describe("runStreakProtection", () => {
  it("returns null when no settings are stored (fresh device)", () => {
    expect(runStreakProtection("2026-05-09")).toBeNull();
  });

  it("increments daysSinceLastEarn on a review day and persists", () => {
    saveSettings({
      ...loadSettings(),
      streakProtection: {
        ...DEFAULT_STREAK_PROTECTION,
        balance: 0,
        spendDates: [],
        daysSinceLastEarn: 5,
        lastEarnCheckDate: null,
      },
    });
    saveStreakData(["2026-05-09"]);

    const result = runStreakProtection("2026-05-09");
    expect(result?.earned).toBe(false);
    expect(result?.spent).toBe(false);

    const persisted = loadSettings().streakProtection;
    expect(persisted.daysSinceLastEarn).toBe(6);
    expect(persisted.lastEarnCheckDate).toBe("2026-05-09");
  });

  it("auto-spends a token to bridge a missed yesterday", () => {
    saveSettings({
      ...loadSettings(),
      streakProtection: {
        ...DEFAULT_STREAK_PROTECTION,
        balance: 2,
        spendDates: [],
        daysSinceLastEarn: 0,
        lastEarnCheckDate: null,
      },
    });
    // Reviewed two days ago. Missed yesterday. Today not yet a review day.
    saveStreakData(["2026-05-07"]);

    const result = runStreakProtection("2026-05-09");
    expect(result?.spent).toBe(true);

    const persisted = loadSettings().streakProtection;
    expect(persisted.balance).toBe(1);
    expect(persisted.spendDates).toEqual(["2026-05-08"]);
  });

  it("is idempotent on repeated same-day calls", () => {
    saveSettings({
      ...loadSettings(),
      streakProtection: {
        ...DEFAULT_STREAK_PROTECTION,
        balance: 0,
        spendDates: [],
        daysSinceLastEarn: 5,
        lastEarnCheckDate: null,
      },
    });
    saveStreakData(["2026-05-09"]);

    runStreakProtection("2026-05-09");
    const afterFirst = loadSettings().streakProtection;
    runStreakProtection("2026-05-09");
    const afterSecond = loadSettings().streakProtection;

    expect(afterSecond).toEqual(afterFirst);
  });

  it("earns a token at the threshold and resets the counter", () => {
    saveSettings({
      ...loadSettings(),
      streakProtection: {
        ...DEFAULT_STREAK_PROTECTION,
        balance: 0,
        spendDates: [],
        daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
        lastEarnCheckDate: null,
      },
    });
    saveStreakData(["2026-05-09"]);

    const result = runStreakProtection("2026-05-09");
    expect(result?.earned).toBe(true);

    const persisted = loadSettings().streakProtection;
    expect(persisted.balance).toBe(1);
    expect(persisted.daysSinceLastEarn).toBe(0);
  });
});

describe("runStreakProtection SSR guard", () => {
  it("returns null when window is undefined", () => {
    const originalWindow = globalThis.window;
    // Deliberately remove for the SSR-guard check.
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(runStreakProtection("2026-05-09")).toBeNull();
    } finally {
      // Restore the global so the rest of the suite is unaffected.
      (globalThis as { window: typeof originalWindow }).window = originalWindow;
    }
  });
});

// The STORAGE_KEY import is referenced so the import statement is not pruned - 
// keeps the test file aligned with the public surface of `persistence.ts`.
void STORAGE_KEY;
