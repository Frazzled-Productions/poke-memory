import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadDailySummary,
  saveDailySummary,
  STORAGE_KEY,
  type DailySummaryRecord,
} from "./dailySummaryPersistence";

// Fixed synthetic "today" used throughout — deliberately not the real date so
// the fixture intent is obvious and git history stays stable over time.
const TODAY = "2025-01-01";

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

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal("window", { localStorage: localStorageMock });
  vi.stubGlobal("localStorage", localStorageMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("returns null when gradeSequence contains invalid grade values", () => {
    const corrupted = { ...freshRecord, gradeSequence: [4, 3, 5] };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(corrupted));
    expect(loadDailySummary("UTC")).toBeNull();
  });

  it("returns null when reviewed disagrees with gradeSequence length", () => {
    const tampered = { ...freshRecord, reviewed: 999 };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(tampered));
    expect(loadDailySummary("UTC")).toBeNull();
  });
});

describe("saveDailySummary", () => {
  it("persists the record to localStorage", () => {
    saveDailySummary(freshRecord);
    expect(JSON.parse(localStorageMock.getItem(STORAGE_KEY)!)).toEqual(freshRecord);
  });
});

