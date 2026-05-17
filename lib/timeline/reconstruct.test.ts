/**
 * Unit tests for lib/timeline/reconstruct.ts
 *
 * Tests live in lib/ so they run in the `node` vitest project (no DOM).
 * All functions under test are pure — no I/O, no Date.now() leakage.
 */

import { describe, it, expect } from "vitest";
import {
  buildCollectionTimeline,
  snapshotAtPosition,
  type BuildTimelineOptions,
  type CollectionTimeline,
} from "./reconstruct";
import { initialReviewState, type ReviewState } from "@/lib/srs/scheduler";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const NOW_MS = new Date("2026-03-01T12:00:00Z").getTime();

function makeEntry(
  subjectKey: string,
  grade: GradeLogEntry["grade"],
  offsetDays: number,
  cardType: GradeLogEntry["cardType"] = "name",
): GradeLogEntry {
  return {
    date: "2026-01-01",
    grade,
    cardType,
    occurredAt: NOW_MS - (60 - offsetDays) * DAY_MS,
    subjectKey,
  };
}

function makeState(
  overrides: Partial<ReviewState> = {},
): ReviewState {
  return { ...initialReviewState(new Date(NOW_MS)), ...overrides };
}

function baseOpts(
  extra: Partial<BuildTimelineOptions> = {},
): BuildTimelineOptions {
  return {
    log: [],
    currentNameCards: new Map(),
    totalSpecies: 10,
    nowMs: NOW_MS,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// buildCollectionTimeline — past direction
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline — past direction", () => {
  it("returns empty past array when log is empty", () => {
    const tl = buildCollectionTimeline(baseOpts());
    expect(tl.past).toHaveLength(0);
  });

  it("ignores entries without subjectKey (legacy entries)", () => {
    const entry: GradeLogEntry = {
      date: "2026-01-01",
      grade: 4,
      cardType: "name",
      occurredAt: NOW_MS - 30 * DAY_MS,
      // subjectKey omitted
    };
    const tl = buildCollectionTimeline(baseOpts({ log: [entry] }));
    expect(tl.past).toHaveLength(0);
  });

  it("records firstSeen on the first grade for a species", () => {
    const log = [makeEntry("1", 4, 0)];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    expect(tl.past.length).toBeGreaterThan(0);
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(1);
  });

  it("accumulates introduced count across multiple species", () => {
    const log = [
      makeEntry("1", 4, 0),
      makeEntry("2", 4, 5),
      makeEntry("3", 4, 10),
    ];
    const tl = buildCollectionTimeline(baseOpts({ log, totalSpecies: 3 }));
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(3);
  });

  it("does not count evolution card types as introduced species", () => {
    const log = [
      makeEntry("1>>>2", 4, 0, "evolution"),
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    // Evolution entries map to no species, so the past timeline is empty.
    // (No species events → no weekly checkpoints to plot.)
    expect(tl.past).toHaveLength(0);
  });

  it("reconstructs mastery crossing after sufficient Good grades", () => {
    // Give a card enough Good grades to cross mastery.
    // nextReview with repeated Goods: needs reps >= MASTERY_REPETITIONS (3)
    // and scheduledDays >= 21. We just need enough grades to see mastery
    // become non-zero — the exact crossing depends on the scheduler.
    const log: GradeLogEntry[] = [];
    const baseTime = NOW_MS - 50 * DAY_MS;
    // Simulate a realistic graduation sequence:
    // Grades: Good (learn step 0), Good (learn step 1 → graduate),
    // then three spaced reviews with Good → eventually hits 21+ days interval.
    const grades: Array<[GradeLogEntry["grade"], number]> = [
      [4, 0],   // learn step 0
      [4, 0],   // graduate (1 day interval)
      [4, 1],   // review → scheduled maybe 4-8 days
      [4, 8],   // review → scheduled maybe 15-30 days
      [4, 20],  // review → stable card, scheduledDays >= 21
    ];
    for (const [grade, dayOffset] of grades) {
      log.push({
        date: "2026-01-01",
        grade,
        cardType: "name",
        occurredAt: baseTime + dayOffset * DAY_MS,
        subjectKey: "1",
      });
    }

    const tl = buildCollectionTimeline(baseOpts({ log }));
    const last = tl.past[tl.past.length - 1];
    // Introduced must be 1.
    expect(last.introduced).toBe(1);
    // Mastery must be 1 after enough Good grades.
    expect(last.mastered).toBe(1);
  });

  it("skips entries with invalid grades without throwing", () => {
    const entry: GradeLogEntry = {
      date: "2026-01-01",
      grade: 3 as GradeLogEntry["grade"], // invalid
      cardType: "name",
      occurredAt: NOW_MS - 10 * DAY_MS,
      subjectKey: "99",
    };
    expect(() =>
      buildCollectionTimeline(baseOpts({ log: [entry] })),
    ).not.toThrow();
  });

  it("past snapshots are sorted chronologically", () => {
    const log = [
      makeEntry("1", 4, 0),
      makeEntry("2", 4, 14),
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    for (let i = 1; i < tl.past.length; i++) {
      expect(tl.past[i].atMs).toBeGreaterThanOrEqual(tl.past[i - 1].atMs);
    }
  });

  it("past snapshot introduced count never decreases", () => {
    const log = [
      makeEntry("1", 4, 0),
      makeEntry("2", 4, 10),
      makeEntry("3", 4, 20),
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    for (let i = 1; i < tl.past.length; i++) {
      expect(tl.past[i].introduced).toBeGreaterThanOrEqual(tl.past[i - 1].introduced);
    }
  });

  it("exposes nowMs and totalSpecies", () => {
    const tl = buildCollectionTimeline(baseOpts({ totalSpecies: 42 }));
    expect(tl.nowMs).toBe(NOW_MS);
    expect(tl.totalSpecies).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// buildCollectionTimeline — future direction
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline — future direction", () => {
  it("returns empty future array when no cards have been reviewed", () => {
    const cards = new Map([["1", makeState({ lastReview: null, stability: 0 })]]);
    const tl = buildCollectionTimeline(baseOpts({ currentNameCards: cards }));
    expect(tl.future).toHaveLength(0);
  });

  it("projects a stable card forward with a non-empty future", () => {
    const state = makeState({
      stability: 30,
      lastReview: "2026-03-01",
      dueDate: "2026-03-31",
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(baseOpts({ currentNameCards: cards }));
    expect(tl.future.length).toBeGreaterThan(0);
  });

  it("a card with very high stability stays retained for the full horizon", () => {
    // stability=9999 means forgetting is way beyond the default 180-day horizon.
    const state = makeState({
      stability: 9999,
      lastReview: "2026-03-01",
      dueDate: "2026-03-31",
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(baseOpts({ currentNameCards: cards }));
    const last = tl.future[tl.future.length - 1];
    // Card should still be retained.
    expect(last.mastered).toBe(1);
  });

  it("a card with low stability drops out within the horizon", () => {
    // stability=1 → power-law inversion gives ~1 day to forget at r=0.9.
    const state = makeState({
      stability: 1,
      lastReview: "2026-02-28",
      dueDate: "2026-02-28", // overdue, forgetMs anchored from nowMs
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(baseOpts({ currentNameCards: cards }));
    // The card should be forgotten within a couple of days of the future.
    const dayThree = tl.future.find((s) => s.atMs > NOW_MS + 2 * DAY_MS);
    if (dayThree) {
      expect(dayThree.mastered).toBe(0);
    }
  });

  it("power-law formula: stability=30 at retentionTarget=0.9 is forgotten near day 30, not day ~3", () => {
    // Regression guard against the exponential formula (R=e^(-t/S)).
    // The exponential gives ~3.16 days for S=30; the correct FSRS power-law
    // gives ~30 days. A card should still be retained at day 15 and forgotten
    // only near day 30.
    const state = makeState({
      stability: 30,
      lastReview: "2026-03-01",
      dueDate: "2026-03-01", // due now, forgetMs anchored from nowMs
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(
      baseOpts({ currentNameCards: cards, retentionTarget: 0.9, horizonDays: 60 }),
    );

    // At day 15 the card must still be retained.
    const day15 = tl.future.find((s) => s.atMs >= NOW_MS + 15 * DAY_MS);
    expect(day15).toBeDefined();
    expect(day15!.mastered).toBe(1);

    // At day 35 (past the ~30-day horizon) the card must be forgotten.
    const day35 = tl.future.find((s) => s.atMs >= NOW_MS + 35 * DAY_MS);
    expect(day35).toBeDefined();
    expect(day35!.mastered).toBe(0);
  });

  it("future snapshots respect horizonDays", () => {
    const state = makeState({
      stability: 200,
      lastReview: "2026-03-01",
      dueDate: "2026-03-31",
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(
      baseOpts({ currentNameCards: cards, horizonDays: 30 }),
    );
    const maxAtMs = Math.max(...tl.future.map((s) => s.atMs));
    expect(maxAtMs).toBeLessThanOrEqual(NOW_MS + 31 * DAY_MS);
  });
});

// ---------------------------------------------------------------------------
// forceAllMastered (superuser flag)
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline — forceAllMastered", () => {
  it("past shows all species as mastered when flag is on", () => {
    const cards = new Map([
      ["1", makeState()],
      ["2", makeState()],
    ]);
    const tl = buildCollectionTimeline(
      baseOpts({ currentNameCards: cards, forceAllMastered: true }),
    );
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(2);
    expect(last.mastered).toBe(2);
  });

  it("future uses synthetic high stability when flag is on", () => {
    // With fake high stability, all cards should stay retained for 180 days.
    const cards = new Map([
      ["1", makeState({ lastReview: null, stability: 0 })],
    ]);
    const tl = buildCollectionTimeline(
      baseOpts({ currentNameCards: cards, forceAllMastered: true }),
    );
    const last = tl.future[tl.future.length - 1];
    // Should still be retained at the end of the horizon.
    expect(last.mastered).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// snapshotAtPosition
// ---------------------------------------------------------------------------

describe("snapshotAtPosition", () => {
  function makeFakeTl(): CollectionTimeline {
    return {
      nowMs: NOW_MS,
      totalSpecies: 10,
      past: [
        { atMs: NOW_MS - 14 * DAY_MS, introduced: 1, mastered: 0 },
        { atMs: NOW_MS - 7 * DAY_MS,  introduced: 2, mastered: 0 },
        { atMs: NOW_MS,               introduced: 3, mastered: 1 },
      ],
      future: [
        { atMs: NOW_MS + 7 * DAY_MS,   introduced: 3, mastered: 1 },
        { atMs: NOW_MS + 14 * DAY_MS,  introduced: 2, mastered: 0 },
        { atMs: NOW_MS + 30 * DAY_MS,  introduced: 1, mastered: 0 },
      ],
    };
  }

  it("position 0 returns last past snapshot (the 'now' anchor)", () => {
    const tl = makeFakeTl();
    const snap = snapshotAtPosition(tl, 0);
    expect(snap.introduced).toBe(3);
    expect(snap.mastered).toBe(1);
  });

  it("position -1 returns the earliest past snapshot", () => {
    const tl = makeFakeTl();
    const snap = snapshotAtPosition(tl, -1);
    expect(snap.introduced).toBe(1);
  });

  it("position 1 returns the last future snapshot", () => {
    const tl = makeFakeTl();
    const snap = snapshotAtPosition(tl, 1);
    expect(snap.introduced).toBe(1);
  });

  it("position 0.5 maps to the middle of the future array", () => {
    const tl = makeFakeTl();
    const snap = snapshotAtPosition(tl, 0.5);
    // future has 3 entries; 0.5 * 2 = 1 → index 1.
    expect(snap.atMs).toBe(NOW_MS + 14 * DAY_MS);
  });

  it("position -0.5 maps to the middle of the past array", () => {
    const tl = makeFakeTl();
    const snap = snapshotAtPosition(tl, -0.5);
    // past has 3 entries; (-0.5 + 1) * 2 = 1 → index 1.
    expect(snap.atMs).toBe(NOW_MS - 7 * DAY_MS);
  });

  it("handles empty past array gracefully", () => {
    const tl: CollectionTimeline = {
      ...makeFakeTl(),
      past: [],
    };
    const snap = snapshotAtPosition(tl, 0);
    expect(snap.introduced).toBe(0);
    expect(snap.mastered).toBe(0);
  });

  it("handles empty future array gracefully at position > 0", () => {
    const tl: CollectionTimeline = {
      ...makeFakeTl(),
      future: [],
    };
    const snap = snapshotAtPosition(tl, 1);
    // Falls back to "now" snapshot from past.
    expect(snap.introduced).toBe(3);
  });

  it("position is clamped — out-of-range values don't throw", () => {
    const tl = makeFakeTl();
    expect(() => snapshotAtPosition(tl, -999)).not.toThrow();
    expect(() => snapshotAtPosition(tl, 999)).not.toThrow();
  });
});
