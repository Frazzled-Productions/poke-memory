import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadDailySummary,
  saveDailySummary,
  mergeDailySummary,
  type DailySummaryRecord,
} from "./dailySummaryPersistence";

const STORAGE_KEY = "poke-memory:daily-summary:v1";

// Fixed "today" used throughout.
const TODAY = "2026-05-15";

// Patch todayInTimezone to return a fixed date so tests are deterministic.
vi.mock("@/lib/utils/format-date", () => ({
  todayInTimezone: (_tz: string, _now?: Date) => TODAY,
}));

// Node environment — polyfill localStorage.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};

vi.stubGlobal("window", { localStorage: localStorageMock });
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const freshRecord: DailySummaryRecord = {
  date: TODAY,
  gradeSequence: [4, 5, 1],
  reviewed: 3,
  newCards: 2,
  mastered: 1,
};

describe("loadDailySummary", () => {
  it("returns null when key is absent", () => {
    expect(loadDailySummary("UTC")).toBeNull();
  });

  it("returns null when stored date is in the past", () => {
    const stale: DailySummaryRecord = { ...freshRecord, date: "2026-05-14" };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(stale));
    expect(loadDailySummary("UTC")).toBeNull();
  });

  it("returns the record when date matches today", () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(freshRecord));
    expect(loadDailySummary("UTC")).toEqual(freshRecord);
  });

  it("returns null on malformed JSON", () => {
    localStorageMock.setItem(STORAGE_KEY, "{ not json }");
    expect(loadDailySummary("UTC")).toBeNull();
  });

  it("returns null when parsed object is missing required fields", () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ date: TODAY }));
    expect(loadDailySummary("UTC")).toBeNull();
  });
});

describe("saveDailySummary", () => {
  it("persists the record to localStorage", () => {
    saveDailySummary(freshRecord);
    expect(JSON.parse(localStorageMock.getItem(STORAGE_KEY)!)).toEqual(freshRecord);
  });
});

describe("mergeDailySummary", () => {
  it("creates a fresh record when existing is null", () => {
    const result = mergeDailySummary(null, {
      gradeSequence: [4, 5],
      newCards: 2,
      mastered: 1,
      date: TODAY,
    });
    expect(result).toEqual({
      date: TODAY,
      gradeSequence: [4, 5],
      reviewed: 2,
      newCards: 2,
      mastered: 1,
    });
  });

  it("appends grade sequence and sums counters when existing is non-null", () => {
    const existing: DailySummaryRecord = {
      date: TODAY,
      gradeSequence: [4, 5],
      reviewed: 2,
      newCards: 1,
      mastered: 0,
    };
    const result = mergeDailySummary(existing, {
      gradeSequence: [1, 2],
      newCards: 2,
      mastered: 1,
      date: TODAY,
    });
    expect(result).toEqual({
      date: TODAY,
      gradeSequence: [4, 5, 1, 2],
      reviewed: 4,
      newCards: 3,
      mastered: 1,
    });
  });

  it("uses the existing date, not the session date, when merging", () => {
    const existing: DailySummaryRecord = {
      date: TODAY,
      gradeSequence: [4],
      reviewed: 1,
      newCards: 1,
      mastered: 0,
    };
    const result = mergeDailySummary(existing, {
      gradeSequence: [5],
      newCards: 0,
      mastered: 0,
      date: "2026-05-14",
    });
    expect(result.date).toBe(TODAY);
  });
});
