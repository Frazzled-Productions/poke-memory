/**
 * masteredCountCache tests (#1608). jsdom (needs localStorage) — mirrors the
 * pattern in dueCountCache.test.tsx.
 *
 * Most tests use a custom in-memory localStorage stub (fast, no cross-test
 * bleed). The StorageEvent-dispatch tests use the real jsdom localStorage
 * because jsdom's StorageEvent constructor rejects a non-Storage storageArea
 * and the writeLocalStorage helper swallows the resulting error silently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readMasteredCountCache,
  writeMasteredCountForLocale,
} from "@/lib/profile/masteredCountCache";
import { KEY_MASTERED_COUNT_BY_LOCALE } from "@/lib/storage/keys";

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

// Capture the real jsdom localStorage before any test can delete it.
// Restored explicitly in the notify-dispatch describe where the real Storage
// instance is needed for jsdom's StorageEvent constructor validation.
const realJsdomLocalStorage: Storage = window.localStorage;

// The stub-localStorage suite: used for all read/write-correctness tests where
// we do NOT need to verify StorageEvent dispatch (the stub is not a real
// Storage instance so jsdom rejects it as a storageArea).
function useStubLocalStorage() {
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
}

// ---------------------------------------------------------------------------
// readMasteredCountCache
// ---------------------------------------------------------------------------

describe("readMasteredCountCache", () => {
  useStubLocalStorage();
  it("returns all-zero when the cache is absent", () => {
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("returns valid cached counts when the stored value is well-formed", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 42, ja: 7, "zh-Hans": 3, "zh-Hant": 1 }),
    );
    expect(readMasteredCountCache()).toEqual({
      en: 42,
      ja: 7,
      "zh-Hans": 3,
      "zh-Hant": 1,
    });
  });

  it("returns all-zero for non-JSON stored data (parse failure path)", () => {
    window.localStorage.setItem(KEY_MASTERED_COUNT_BY_LOCALE, "not json {{");
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("returns all-zero for a stored JSON null (type-guard rejection)", () => {
    window.localStorage.setItem(KEY_MASTERED_COUNT_BY_LOCALE, "null");
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("returns all-zero for a stored JSON array (wrong shape)", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify([1, 2, 3, 4]),
    );
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("falls back to 0 for the en locale when its stored value is not a number", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: "not-a-number", ja: 5, "zh-Hans": 2, "zh-Hant": 1 }),
    );
    const result = readMasteredCountCache();
    expect(result.en).toBe(0);
    expect(result.ja).toBe(5);
    expect(result["zh-Hans"]).toBe(2);
    expect(result["zh-Hant"]).toBe(1);
  });

  it("falls back to 0 for the ja locale when its stored value is not a number", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: null, "zh-Hans": 2, "zh-Hant": 1 }),
    );
    const result = readMasteredCountCache();
    expect(result.en).toBe(10);
    expect(result.ja).toBe(0);
    expect(result["zh-Hans"]).toBe(2);
    expect(result["zh-Hant"]).toBe(1);
  });

  it("falls back to 0 for zh-Hans when its stored value is not a number", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: 3, "zh-Hans": true, "zh-Hant": 4 }),
    );
    const result = readMasteredCountCache();
    expect(result.en).toBe(10);
    expect(result.ja).toBe(3);
    expect(result["zh-Hans"]).toBe(0);
    expect(result["zh-Hant"]).toBe(4);
  });

  it("falls back to 0 for zh-Hant when its stored value is not a number", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: 3, "zh-Hans": 2, "zh-Hant": "twenty" }),
    );
    const result = readMasteredCountCache();
    expect(result.en).toBe(10);
    expect(result.ja).toBe(3);
    expect(result["zh-Hans"]).toBe(2);
    expect(result["zh-Hant"]).toBe(0);
  });

  it("falls back to 0 for all locales when their values are missing from the stored object", () => {
    // An object with completely different keys — every locale key is absent.
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ unexpected: 99 }),
    );
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("round-trips 0 correctly (does not confuse 0 with falsy absence)", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 }),
    );
    expect(readMasteredCountCache()).toEqual({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });
});

// ---------------------------------------------------------------------------
// writeMasteredCountForLocale — correctness (stub localStorage)
// ---------------------------------------------------------------------------

describe("writeMasteredCountForLocale", () => {
  useStubLocalStorage();

  it("writes a count for the en locale, preserving the rest", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 0, ja: 5, "zh-Hans": 2, "zh-Hant": 1 }),
    );
    writeMasteredCountForLocale("en", 42);
    expect(readMasteredCountCache()).toEqual({
      en: 42,
      ja: 5,
      "zh-Hans": 2,
      "zh-Hant": 1,
    });
  });

  it("writes a count for the ja locale, preserving the rest", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: 0, "zh-Hans": 3, "zh-Hant": 2 }),
    );
    writeMasteredCountForLocale("ja", 7);
    expect(readMasteredCountCache()).toEqual({
      en: 10,
      ja: 7,
      "zh-Hans": 3,
      "zh-Hant": 2,
    });
  });

  it("writes a count for zh-Hans, preserving the rest", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: 5, "zh-Hans": 0, "zh-Hant": 2 }),
    );
    writeMasteredCountForLocale("zh-Hans", 15);
    expect(readMasteredCountCache()).toEqual({
      en: 10,
      ja: 5,
      "zh-Hans": 15,
      "zh-Hant": 2,
    });
  });

  it("writes a count for zh-Hant, preserving the rest", () => {
    window.localStorage.setItem(
      KEY_MASTERED_COUNT_BY_LOCALE,
      JSON.stringify({ en: 10, ja: 5, "zh-Hans": 3, "zh-Hant": 0 }),
    );
    writeMasteredCountForLocale("zh-Hant", 9);
    expect(readMasteredCountCache()).toEqual({
      en: 10,
      ja: 5,
      "zh-Hans": 3,
      "zh-Hant": 9,
    });
  });

  it("writes from an empty cache (no prior value), defaulting absent locales to 0", () => {
    writeMasteredCountForLocale("en", 20);
    expect(readMasteredCountCache()).toEqual({
      en: 20,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
  });

  it("sequential writes to different locales accumulate correctly", () => {
    writeMasteredCountForLocale("en", 10);
    writeMasteredCountForLocale("ja", 5);
    writeMasteredCountForLocale("zh-Hans", 3);
    writeMasteredCountForLocale("zh-Hant", 1);
    expect(readMasteredCountCache()).toEqual({
      en: 10,
      ja: 5,
      "zh-Hans": 3,
      "zh-Hant": 1,
    });
  });

  it("overwrites a previous count for the same locale", () => {
    writeMasteredCountForLocale("en", 10);
    writeMasteredCountForLocale("en", 20);
    expect(readMasteredCountCache().en).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// writeMasteredCountForLocale — StorageEvent dispatch (real jsdom localStorage)
//
// jsdom's StorageEvent constructor validates that storageArea is a real Storage
// instance. The custom in-memory stub is not a Storage instance, so
// writeLocalStorage's `new StorageEvent(...)` call throws and is swallowed.
// These tests use the real jsdom localStorage (cleared before/after each test)
// so the dispatch path executes correctly.
// ---------------------------------------------------------------------------

describe("writeMasteredCountForLocale — notify dispatch", () => {
  // Restore the real jsdom Storage so jsdom's StorageEvent constructor accepts
  // storageArea (it rejects non-Storage objects and the write helper swallows
  // the error, causing the dispatch to be silently skipped).
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
    vi.restoreAllMocks();
  });

  it("dispatches a StorageEvent (notify: true) after a successful write", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    writeMasteredCountForLocale("en", 5);

    const storageEvents = dispatchSpy.mock.calls
      .map((args) => args[0])
      .filter((e) => e instanceof StorageEvent) as StorageEvent[];
    expect(storageEvents.length).toBeGreaterThanOrEqual(1);
    const evt = storageEvents[storageEvents.length - 1];
    expect(evt.key).toBe(KEY_MASTERED_COUNT_BY_LOCALE);
  });

  it("StorageEvent carries the updated serialised value as newValue", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    writeMasteredCountForLocale("ja", 12);

    const storageEvents = dispatchSpy.mock.calls
      .map((args) => args[0])
      .filter((e) => e instanceof StorageEvent) as StorageEvent[];
    expect(storageEvents.length).toBeGreaterThanOrEqual(1);
    const evt = storageEvents[storageEvents.length - 1];
    expect(evt.newValue).not.toBeNull();
    const parsed = JSON.parse(evt.newValue!) as Record<string, unknown>;
    expect(parsed["ja"]).toBe(12);
  });
});
