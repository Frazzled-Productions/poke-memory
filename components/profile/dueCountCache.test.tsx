/**
 * dueCountCache tests (#1484). jsdom (needs a localStorage stub) - mirrors the
 * pattern in useProfileStatus.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readDueCountCache,
  writeDueCounts,
  writeDueCountForLocale,
  readHasHistoryCache,
  writeHasHistory,
} from "@/lib/profile/dueCountCache";
import { KEY_DUE_COUNT_BY_LOCALE, KEY_HAS_HISTORY_BY_LOCALE } from "@/lib/storage/keys";

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

describe("dueCountCache", () => {
  it("returns all-zero when the cache is absent", () => {
    expect(readDueCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("writeDueCounts merges over the existing cache", () => {
    writeDueCounts({ en: 5 });
    writeDueCounts({ ja: 3 });
    expect(readDueCountCache()).toEqual({
      en: 5,
      ja: 3,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("writeDueCountForLocale updates a single locale, preserving the rest", () => {
    writeDueCounts({ en: 2 });
    writeDueCountForLocale("zh-Hans", 7);
    const cache = readDueCountCache();
    expect(cache["zh-Hans"]).toBe(7);
    expect(cache.en).toBe(2);
  });

  it("returns all-zero for malformed stored data", () => {
    window.localStorage.setItem(KEY_DUE_COUNT_BY_LOCALE, "not json");
    expect(readDueCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Has-history cache - readHasHistoryCache / writeHasHistory
// ---------------------------------------------------------------------------

describe("hasHistoryCache", () => {
  it("returns all-false when the cache is absent", () => {
    expect(readHasHistoryCache()).toEqual({
      en: false,
      ja: false,
      "zh-Hans": false,
      "zh-Hant": false,
    });
  });

  it("round-trips a write and read correctly (all locales)", () => {
    writeHasHistory({ en: true, ja: false, "zh-Hans": true, "zh-Hant": false });
    expect(readHasHistoryCache()).toEqual({
      en: true,
      ja: false,
      "zh-Hans": true,
      "zh-Hant": false,
    });
  });

  it("round-trips all-true", () => {
    writeHasHistory({ en: true, ja: true, "zh-Hans": true, "zh-Hant": true });
    expect(readHasHistoryCache()).toEqual({
      en: true,
      ja: true,
      "zh-Hans": true,
      "zh-Hant": true,
    });
  });

  it("returns all-false for malformed (non-object) stored data", () => {
    window.localStorage.setItem(KEY_HAS_HISTORY_BY_LOCALE, "not json");
    expect(readHasHistoryCache()).toEqual({
      en: false,
      ja: false,
      "zh-Hans": false,
      "zh-Hant": false,
    });
  });

  it("returns all-false for a stored array (wrong shape)", () => {
    window.localStorage.setItem(KEY_HAS_HISTORY_BY_LOCALE, JSON.stringify([true, false]));
    expect(readHasHistoryCache()).toEqual({
      en: false,
      ja: false,
      "zh-Hans": false,
      "zh-Hant": false,
    });
  });

  it("returns false for any locale whose stored value is not exactly true (partial/truthy coercion)", () => {
    window.localStorage.setItem(
      KEY_HAS_HISTORY_BY_LOCALE,
      // "1" and 1 are truthy but not === true; only true should be accepted.
      JSON.stringify({ en: 1, ja: "yes", "zh-Hans": true, "zh-Hant": null }),
    );
    expect(readHasHistoryCache()).toEqual({
      en: false,
      ja: false,
      "zh-Hans": true,
      "zh-Hant": false,
    });
  });

  it("overwriting with writeHasHistory replaces the entire cache (no merge)", () => {
    writeHasHistory({ en: true, ja: true, "zh-Hans": true, "zh-Hant": true });
    writeHasHistory({ en: false, ja: false, "zh-Hans": false, "zh-Hant": false });
    expect(readHasHistoryCache()).toEqual({
      en: false,
      ja: false,
      "zh-Hans": false,
      "zh-Hant": false,
    });
  });
});
