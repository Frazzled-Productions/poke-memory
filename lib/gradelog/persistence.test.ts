import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadGradeLog,
  appendGradeEntry,
  pruneGradeLog,
  computeGradeTotals,
  type GradeLogEntry,
} from "./persistence";
import { __resetForTests } from "@/lib/idb/db";

// fake-indexeddb/auto is installed by vitest.setup.node.ts.

// Reset the IDB database between tests to avoid state leaking.
async function resetIdb() {
  // Close the open DB connection first so deleteDatabase doesn't get blocked.
  await __resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("poke-memory");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe("loadGradeLog (IDB-backed)", () => {
  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("CustomEvent", class extends Event {
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        super(type);
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] when key is absent", async () => {
    expect(await loadGradeLog()).toEqual([]);
  });

  it("returns valid entries after appending", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    await appendGradeEntry({ date: "2026-05-09", grade: 1, cardType: "evolution" });
    const log = await loadGradeLog();
    expect(log).toHaveLength(2);
    expect(log[0].grade).toBe(4);
    expect(log[1].grade).toBe(1);
  });

  it("returns entries with subjectKey set when provided", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name", subjectKey: "42" });
    const log = await loadGradeLog();
    expect(log[0].subjectKey).toBe("42");
  });

  it("does not set subjectKey when not provided", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    const log = await loadGradeLog();
    expect(log[0].subjectKey).toBeUndefined();
  });
});

describe("appendGradeEntry (IDB-backed)", () => {
  beforeEach(async () => {
    await resetIdb();
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("CustomEvent", class extends Event {
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        super(type);
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends to an empty log", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    const log = await loadGradeLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ date: "2026-05-09", grade: 4, cardType: "name" });
    expect(typeof log[0].occurredAt).toBe("number");
  });

  it("persists subjectKey when provided", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name", subjectKey: "7" });
    const log = await loadGradeLog();
    expect(log[0].subjectKey).toBe("7");
  });

  it("does not set subjectKey when not provided", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    const log = await loadGradeLog();
    expect(log[0].subjectKey).toBeUndefined();
  });

  it("appends to an existing log without overwriting prior entries", async () => {
    await appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" });
    await appendGradeEntry({ date: "2026-05-09", grade: 1, cardType: "name" });
    expect(await loadGradeLog()).toHaveLength(2);
  });

  it("is a no-op when window is undefined (SSR guard)", async () => {
    vi.unstubAllGlobals();
    await expect(
      appendGradeEntry({ date: "2026-05-09", grade: 4, cardType: "name" })
    ).resolves.toBeNull();
  });

  it("prunes entries older than 365 days on write", async () => {
    // Seed old entry directly into IDB via appendGradeEntry with an old date,
    // then add a newer entry and verify pruning.
    // We manually seed old data by calling the store directly.
    const { openAppDb } = await import("@/lib/idb/db");
    vi.stubGlobal("window", {
      indexedDB: globalThis.indexedDB,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      dispatchEvent: () => true,
    });
    const db = await openAppDb();
    const oldEntries: GradeLogEntry[] = [
      { date: "2024-05-08", grade: 4, cardType: "name", occurredAt: 1000 },
      { date: "2025-05-09", grade: 2, cardType: "name", occurredAt: 2000 },
    ];
    await db.put("kv", JSON.stringify(oldEntries), "poke-memory:grade-log:v1");

    await appendGradeEntry({ date: "2026-05-09", grade: 5, cardType: "evolution" });
    const log = await loadGradeLog();
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
