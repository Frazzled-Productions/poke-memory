import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadStreakData,
  saveStreakData,
  recordReview,
  STREAK_MIN_CARDS,
  STREAK_UPDATED_EVENT,
} from "./persistence";

const MIN = STREAK_MIN_CARDS;

function makeMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

const STREAK_KEY = "poke-memory:streak:v1";

describe("loadStreakData", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array when key is absent", () => {
    expect(loadStreakData()).toEqual([]);
  });

  it("returns stored dates", () => {
    saveStreakData(["2026-05-08", "2026-05-09"]);
    expect(loadStreakData()).toEqual(["2026-05-08", "2026-05-09"]);
  });

  it("returns empty array on corrupted JSON", () => {
    storage.setItem(STREAK_KEY, "not-json{{{");
    expect(loadStreakData()).toEqual([]);
  });

  it("returns empty array when stored value contains non-strings", () => {
    storage.setItem(STREAK_KEY, JSON.stringify([1, 2, 3]));
    expect(loadStreakData()).toEqual([]);
  });

  it("returns empty array when stored value is not an array", () => {
    storage.setItem(STREAK_KEY, JSON.stringify({ date: "2026-05-09" }));
    expect(loadStreakData()).toEqual([]);
  });
});

describe("recordReview", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a date to an empty store (first-entry path)", () => {
    recordReview("2026-05-09", MIN, false);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("is idempotent — calling twice with the same date stores it once", () => {
    recordReview("2026-05-09", MIN, false);
    recordReview("2026-05-09", MIN, false);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("keeps dates sorted after adding entries out of order", () => {
    recordReview("2026-05-09", MIN, false);
    recordReview("2026-05-07", MIN, false);
    recordReview("2026-05-08", MIN, false);
    expect(loadStreakData()).toEqual(["2026-05-07", "2026-05-08", "2026-05-09"]);
  });

  it("recovers gracefully from corrupted storage and writes the new date", () => {
    storage.setItem(STREAK_KEY, "corrupted{");
    recordReview("2026-05-09", MIN, false);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("is a no-op when window is undefined (SSR guard)", () => {
    vi.unstubAllGlobals();
    expect(() => recordReview("2026-05-09", MIN, false)).not.toThrow();
  });

  it("dispatches a STREAK_UPDATED_EVENT on a new date", () => {
    recordReview("2026-05-09", MIN, false);
    const dispatchEvent = (globalThis as unknown as { window: { dispatchEvent: ReturnType<typeof vi.fn> } }).window.dispatchEvent;
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(STREAK_UPDATED_EVENT);
  });

  it("does not dispatch on a duplicate date (no-op early return)", () => {
    recordReview("2026-05-09", MIN, false);
    const dispatchEvent = (globalThis as unknown as { window: { dispatchEvent: ReturnType<typeof vi.fn> } }).window.dispatchEvent;
    dispatchEvent.mockClear();
    recordReview("2026-05-09", MIN, false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not record when gradedToday < STREAK_MIN_CARDS and due queue is not empty", () => {
    recordReview("2026-05-09", MIN - 1, false);
    expect(loadStreakData()).toEqual([]);
  });

  it("records when gradedToday === STREAK_MIN_CARDS", () => {
    recordReview("2026-05-09", MIN, false);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("records when gradedToday > STREAK_MIN_CARDS", () => {
    recordReview("2026-05-09", MIN + 10, false);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("records when due queue is empty even if gradedToday is below threshold", () => {
    recordReview("2026-05-09", 1, true);
    expect(loadStreakData()).toEqual(["2026-05-09"]);
  });

  it("does not dispatch STREAK_UPDATED_EVENT when below threshold", () => {
    recordReview("2026-05-09", MIN - 1, false);
    const dispatchEvent = (globalThis as unknown as { window: { dispatchEvent: ReturnType<typeof vi.fn> } }).window.dispatchEvent;
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
