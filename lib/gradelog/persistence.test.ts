import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadGradeLog,
  appendGradeEntry,
  pruneGradeLog,
  computeGradeTotals,
  type GradeLogEntry,
} from "./persistence";

const KEY = "poke-memory:grade-log:v1";

function makeMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

describe("loadGradeLog", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] when key is absent", () => {
    expect(loadGradeLog()).toEqual([]);
  });

  it("returns [] on corrupted JSON", () => {
    storage.setItem(KEY, "{{bad");
    expect(loadGradeLog()).toEqual([]);
  });

  it("returns [] when stored value is not an array", () => {
    storage.setItem(KEY, JSON.stringify({ grade: 1 }));
    expect(loadGradeLog()).toEqual([]);
  });

  it("returns [] when an entry has an invalid grade (e.g. 3)", () => {
    storage.setItem(KEY, JSON.stringify([{ date: "2026-05-09", grade: 3, cardType: "name" }]));
    expect(loadGradeLog()).toEqual([]);
  });

  it("returns [] when an entry is missing a field", () => {
    storage.setItem(KEY, JSON.stringify([{ grade: 1, cardType: "name" }]));
    expect(loadGradeLog()).toEqual([]);
  });

  it("returns valid entries", () => {
    const entries: GradeLogEntry[] = [
      { date: "2026-05-09", grade: 4, cardType: "name", occurredAt: 1700000000000 },
      { date: "2026-05-09", grade: 1, cardType: "evolution", occurredAt: 1700000000001 },
    ];
    storage.setItem(KEY, JSON.stringify(entries));
    expect(loadGradeLog()).toEqual(entries);
  });

  it("synthesizes occurredAt for legacy entries that lack it", () => {
    storage.setItem(
      KEY,
      JSON.stringify([
        { date: "2026-05-09", grade: 4, cardType: "name" },
        { date: "2026-05-09", grade: 1, cardType: "name" },
        { date: "2026-05-10", grade: 5, cardType: "evolution" },
      ]),
    );
    const result = loadGradeLog();
    expect(result).toHaveLength(3);
    // Same-day legacy entries get distinct synthesized occurredAt values.
    expect(result[0].occurredAt).not.toBe(result[1].occurredAt);
    // Earlier date sorts before later date numerically.
    expect(result[0].occurredAt).toBeLessThan(result[2].occurredAt);
    // All entries now have a numeric occurredAt field.
    expect(result.every((e) => typeof e.occurredAt === "number")).toBe(true);
  });
});

describe("appendGradeEntry", () => {
  let storage: ReturnType<typeof makeMockStorage>;

  beforeEach(() => {
    storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends to an empty log", () => {
    appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    const log = loadGradeLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ date: "2026-05-09", grade: 4, cardType: "name" });
    expect(typeof log[0].occurredAt).toBe("number");
  });

  it("appends to an existing log without overwriting prior entries", () => {
    appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    appendGradeEntry({ date: "2026-05-09", grade: 1, cardType: "name" });
    expect(loadGradeLog()).toHaveLength(2);
  });

  it("is a no-op when window is undefined (SSR guard)", () => {
    vi.unstubAllGlobals();
    expect(() =>
      appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" })
    ).not.toThrow();
  });

  it("does not throw on QuotaExceededError", () => {
    const err = new DOMException("quota exceeded", "QuotaExceededError");
    storage.setItem = () => { throw err; };
    expect(() =>
      appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" })
    ).not.toThrow();
  });

  it("prunes entries older than 365 days on write", () => {
    storage.setItem(KEY, JSON.stringify([
      { date: "2024-05-08", grade: 4, cardType: "name" },
      { date: "2025-05-09", grade: 2, cardType: "name" },
    ]));
    appendGradeEntry({ date: "2026-05-09", grade: 5, cardType: "evolution" });
    const log = loadGradeLog();
    expect(log.some((e) => e.date === "2024-05-08")).toBe(false);
    expect(log.some((e) => e.date === "2025-05-09")).toBe(true);
    expect(log.some((e) => e.date === "2026-05-09")).toBe(true);
  });
});

describe("pruneGradeLog", () => {
  const log: GradeLogEntry[] = [
    { date: "2026-04-01", grade: 4, cardType: "name", occurredAt: 1 },
    { date: "2026-04-20", grade: 2, cardType: "name", occurredAt: 2 },
    { date: "2026-05-09", grade: 5, cardType: "evolution", occurredAt: 3 },
  ];

  it("retains entries within the cutoff window", () => {
    const pruned = pruneGradeLog(log, 30, "2026-05-09");
    expect(pruned.map((e) => e.date)).toEqual(["2026-04-20", "2026-05-09"]);
  });

  it("retains only today's entry when keepDays is 0", () => {
    const pruned = pruneGradeLog(log, 0, "2026-05-09");
    expect(pruned).toHaveLength(1);
    expect(pruned[0].date).toBe("2026-05-09");
  });

  it("retains everything when keepDays is large", () => {
    const pruned = pruneGradeLog(log, 365, "2026-05-09");
    expect(pruned).toHaveLength(3);
  });

  it("returns [] for an empty log", () => {
    expect(pruneGradeLog([], 30, "2026-05-09")).toEqual([]);
  });
});

describe("computeGradeTotals", () => {
  it("returns zeros for an empty log", () => {
    expect(computeGradeTotals([])).toEqual({ 1: 0, 2: 0, 4: 0, 5: 0 });
  });

  it("counts each grade correctly", () => {
    const log: GradeLogEntry[] = [
      { date: "2026-05-09", grade: 1, cardType: "name", occurredAt: 1 },
      { date: "2026-05-09", grade: 1, cardType: "name", occurredAt: 2 },
      { date: "2026-05-09", grade: 4, cardType: "evolution", occurredAt: 3 },
      { date: "2026-05-09", grade: 5, cardType: "name", occurredAt: 4 },
    ];
    expect(computeGradeTotals(log)).toEqual({ 1: 2, 2: 0, 4: 1, 5: 1 });
  });
});
