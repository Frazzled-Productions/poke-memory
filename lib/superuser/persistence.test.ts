import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { KEY_SUPERUSER_CLEANUP_PENDING } from "@/lib/storage/keys";

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
    saveFlags({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false });
    expect(loadFlags()).toEqual({
      pretendAllMastered: true,
      forceNextStreakMilestone: false,
      forceCardsGraduated: false,
      forceTokenToast: false, qaSeedMode: false,
    });
  });

  it("round-trips forceCardsGraduated through save/load", () => {
    saveFlags({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: true, forceTokenToast: false, qaSeedMode: false });
    expect(loadFlags()).toEqual({
      pretendAllMastered: false,
      forceNextStreakMilestone: false,
      forceCardsGraduated: true,
      forceTokenToast: false, qaSeedMode: false,
    });
  });

  it("round-trips qaSeedMode through save/load", () => {
    saveFlags({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: true });
    expect(loadFlags()).toEqual({
      pretendAllMastered: false,
      forceNextStreakMilestone: false,
      forceCardsGraduated: false,
      forceTokenToast: false, qaSeedMode: true,
    });
  });

  it("clearFlags removes the persisted key, returning to defaults", () => {
    saveFlags({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false });
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
      JSON.stringify({ pretendAllMastered: "yes", forceNextStreakMilestone: 1, forceCardsGraduated: "true", forceTokenToast: false, qaSeedMode: "true" }),
    );
    expect(loadFlags()).toEqual({
      pretendAllMastered: false,
      forceNextStreakMilestone: false,
      forceCardsGraduated: false,
      forceTokenToast: false, qaSeedMode: false,
    });
  });

  it("defaults forceCardsGraduated to false when field is absent from stored blob", () => {
    // Simulate a persisted blob from before this flag was added.
    globalThis.localStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ pretendAllMastered: false, forceNextStreakMilestone: false }),
    );
    expect(loadFlags().forceCardsGraduated).toBe(false);
  });

  it("defaults qaSeedMode to false when field is absent from stored blob", () => {
    // Simulate a blob from before qaSeedMode was added (#1326).
    globalThis.localStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false }),
    );
    expect(loadFlags().qaSeedMode).toBe(false);
  });

  it("defaults forceTokenToast to false when field is absent from stored blob", () => {
    // Simulate an existing user's blob from before forceTokenToast was added
    // (#1443): an absent field must coerce to false, never silently true.
    globalThis.localStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, qaSeedMode: false }),
    );
    expect(loadFlags().forceTokenToast).toBe(false);
  });
});

describe("anyFlagTrue / isAnyFlagOn", () => {
  it("anyFlagTrue is false on defaults", () => {
    expect(anyFlagTrue(DEFAULT_FLAGS)).toBe(false);
  });

  it("anyFlagTrue is true when any single flag is on", () => {
    expect(
      anyFlagTrue({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false }),
    ).toBe(true);
    expect(
      anyFlagTrue({ pretendAllMastered: false, forceNextStreakMilestone: true, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false }),
    ).toBe(true);
    expect(
      anyFlagTrue({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: true, forceTokenToast: false, qaSeedMode: false }),
    ).toBe(true);
    expect(
      anyFlagTrue({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: true, qaSeedMode: false }),
    ).toBe(true);
    expect(
      anyFlagTrue({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: true }),
    ).toBe(true);
  });

  it("isAnyFlagOn reads from localStorage", () => {
    expect(isAnyFlagOn()).toBe(false);
    saveFlags({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false });
    expect(isAnyFlagOn()).toBe(true);
  });

  it("isAnyFlagOn is true when forceCardsGraduated is the only on flag", () => {
    saveFlags({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: true, forceTokenToast: false, qaSeedMode: false });
    expect(isAnyFlagOn()).toBe(true);
  });

  it("isAnyFlagOn is true when qaSeedMode is the only on flag", () => {
    saveFlags({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: true });
    expect(isAnyFlagOn()).toBe(true);
  });

  it("isAnyFlagOn is true when forceTokenToast is the only on flag", () => {
    // The sync write-guard suppresses cloud writes while any flag is on, so
    // forceTokenToast must register through isAnyFlagOn like every other flag.
    saveFlags({ pretendAllMastered: false, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: true, qaSeedMode: false });
    expect(isAnyFlagOn()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cleanup-pending marker (#1854 F16)
//
// isAnyFlagOn() must return true while the cleanup-pending marker is set, even
// when all flags are off. This keeps cloud writes suppressed from the moment
// flags are persisted as all-off until exitCleanup finishes successfully.
// ---------------------------------------------------------------------------

describe("isAnyFlagOn - cleanup-pending marker (#1854 F16)", () => {
  it("returns true when the cleanup-pending marker is set, even with all flags off", () => {
    // All flags off.
    clearFlags();
    expect(isAnyFlagOn()).toBe(false);
    // Set the marker (simulates setFlag setting it before saveFlags).
    globalThis.localStorage.setItem(KEY_SUPERUSER_CLEANUP_PENDING, "true");
    expect(isAnyFlagOn()).toBe(true);
  });

  it("returns false after the cleanup-pending marker is removed", () => {
    globalThis.localStorage.setItem(KEY_SUPERUSER_CLEANUP_PENDING, "true");
    expect(isAnyFlagOn()).toBe(true);
    globalThis.localStorage.removeItem(KEY_SUPERUSER_CLEANUP_PENDING);
    expect(isAnyFlagOn()).toBe(false);
  });

  it("returns true when both a flag AND the marker are set", () => {
    saveFlags({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false });
    globalThis.localStorage.setItem(KEY_SUPERUSER_CLEANUP_PENDING, "true");
    expect(isAnyFlagOn()).toBe(true);
  });

  it("returns true with marker set even after flags are cleared (the F16 window)", () => {
    // Simulate the exact window that F16 was about: flags were cleared by
    // saveFlags/clearFlags but exitCleanup has not yet finished.
    saveFlags({ pretendAllMastered: true, forceNextStreakMilestone: false, forceCardsGraduated: false, forceTokenToast: false, qaSeedMode: false });
    // Step 1: set marker (before saveFlags).
    globalThis.localStorage.setItem(KEY_SUPERUSER_CLEANUP_PENDING, "true");
    // Step 2: persist all-off flags (simulates saveFlags(DEFAULT_FLAGS)).
    clearFlags();
    // At this point flags are all off, but the marker keeps the guard active.
    expect(isAnyFlagOn()).toBe(true);
    // Step 3: cleanup succeeds - marker removed.
    globalThis.localStorage.removeItem(KEY_SUPERUSER_CLEANUP_PENDING);
    // Now writes are unblocked.
    expect(isAnyFlagOn()).toBe(false);
  });

  it("stays true when cleanup fails (marker not removed)", () => {
    globalThis.localStorage.setItem(KEY_SUPERUSER_CLEANUP_PENDING, "true");
    clearFlags();
    // Simulate a failed cleanup: marker is left set (the catch branch logs but
    // does NOT removeItem). Writes must remain suppressed.
    expect(isAnyFlagOn()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// null localStorage (#1952) - some browser configurations (e.g. Windows with
// site data/cookies blocked) expose `window.localStorage` as `null` rather
// than merely absent; a direct `.getItem`/`.setItem`/`.removeItem` call
// throws. Every read here must degrade to its safe default and every write
// must swallow the error, WITHOUT throwing.
// ---------------------------------------------------------------------------

describe("null localStorage (#1952)", () => {
  // Captured fresh in beforeEach (not at module-load time) - the outer
  // top-level beforeEach runs first on each test and (re)installs the
  // polyfilled localStorage/window, so we stash THAT before nulling it out.
  let realLocalStorage: Storage | undefined;
  let realWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    realLocalStorage = globalThis.localStorage;
    realWindow = globalThis.window;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: null },
    });
  });

  afterEach(() => {
    // Restore the polyfilled localStorage/window so subsequent describe
    // blocks (and their own beforeEach) are not polluted by the null stub.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: realLocalStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: realWindow,
    });
  });

  it("isUnlocked() returns false (locked) and does not throw", () => {
    expect(() => isUnlocked()).not.toThrow();
    expect(isUnlocked()).toBe(false);
  });

  it("isAnyFlagOn() returns false and does not throw - the sync write-guard must default to not-paused when storage is unavailable", () => {
    expect(() => isAnyFlagOn()).not.toThrow();
    expect(isAnyFlagOn()).toBe(false);
  });

  it("setUnlocked(false) does not throw", () => {
    expect(() => setUnlocked(false)).not.toThrow();
  });

  it("clearFlags() does not throw", () => {
    expect(() => clearFlags()).not.toThrow();
  });
});
