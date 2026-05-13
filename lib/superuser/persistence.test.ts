import { describe, it, expect, beforeEach } from "vitest";
import {
  isUnlocked,
  setUnlocked,
  loadFlags,
  saveFlags,
  clearFlags,
  anyFlagTrue,
  isAnyFlagOn,
  DEFAULT_FLAGS,
  UNLOCKED_KEY,
  FLAGS_KEY,
} from "./persistence";

beforeEach(() => {
  // node project lacks a DOM, but it has a localStorage polyfill via happy-dom
  // when used via @testing-library; for the pure node project we shim it here.
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    });
  }
  if (typeof globalThis.window === "undefined") {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: globalThis.localStorage },
    });
  }
  globalThis.localStorage.clear();
});

describe("isUnlocked / setUnlocked", () => {
  it("defaults to false when no key is set", () => {
    expect(isUnlocked()).toBe(false);
  });

  it("setUnlocked(true) writes 'true' to the unlocked key", () => {
    setUnlocked(true);
    expect(globalThis.localStorage.getItem(UNLOCKED_KEY)).toBe("true");
    expect(isUnlocked()).toBe(true);
  });

  it("setUnlocked(false) removes the key", () => {
    setUnlocked(true);
    setUnlocked(false);
    expect(globalThis.localStorage.getItem(UNLOCKED_KEY)).toBeNull();
    expect(isUnlocked()).toBe(false);
  });
});

describe("loadFlags / saveFlags / clearFlags", () => {
  it("returns DEFAULT_FLAGS when nothing is stored", () => {
    expect(loadFlags()).toEqual(DEFAULT_FLAGS);
  });

  it("round-trips a flag through save/load", () => {
    saveFlags({ pretendAllMastered: true });
    expect(loadFlags()).toEqual({ pretendAllMastered: true });
  });

  it("clearFlags removes the persisted key, returning to defaults", () => {
    saveFlags({ pretendAllMastered: true });
    clearFlags();
    expect(globalThis.localStorage.getItem(FLAGS_KEY)).toBeNull();
    expect(loadFlags()).toEqual(DEFAULT_FLAGS);
  });

  it("rejects malformed JSON gracefully and returns defaults", () => {
    globalThis.localStorage.setItem(FLAGS_KEY, "{not json");
    expect(loadFlags()).toEqual(DEFAULT_FLAGS);
  });

  it("coerces non-boolean stored values to false", () => {
    globalThis.localStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ pretendAllMastered: "yes" }),
    );
    expect(loadFlags()).toEqual({ pretendAllMastered: false });
  });
});

describe("anyFlagTrue / isAnyFlagOn", () => {
  it("anyFlagTrue is false on defaults", () => {
    expect(anyFlagTrue(DEFAULT_FLAGS)).toBe(false);
  });

  it("anyFlagTrue is true when any single flag is on", () => {
    expect(anyFlagTrue({ pretendAllMastered: true })).toBe(true);
  });

  it("isAnyFlagOn reads from localStorage", () => {
    expect(isAnyFlagOn()).toBe(false);
    saveFlags({ pretendAllMastered: true });
    expect(isAnyFlagOn()).toBe(true);
  });
});
