/**
 * Unit tests for lib/timeline/reconstruct.ts
 *
 * Tests live in lib/ so they run in the `node` vitest project (no DOM).
 * All functions under test are pure - no I/O, no Date.now() leakage.
 */

import { describe, it, expect } from "vitest";
import {
  buildCollectionTimeline,
  buildSpeciesMasteryDates,
  snapshotAtPosition,
  type BuildTimelineOptions,
  type CollectionTimeline,
  type SpeciesMasteryDatesOptions,
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
    locale: "en",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// buildCollectionTimeline - past direction
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline - past direction", () => {
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

  it("reconstructs mastery crossing after sufficient Good grades on BOTH legs (#1448)", () => {
    // Species-level mastery requires BOTH name and reverse cards to cross the
    // FSRS gate. Both legs receive the same graduation sequence.
    const log: GradeLogEntry[] = [];
    const baseTime = NOW_MS - 50 * DAY_MS;
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
      // Reverse card follows the same sequence (slightly offset to appear after name).
      log.push({
        date: "2026-01-01",
        grade,
        cardType: "reverse",
        occurredAt: baseTime + dayOffset * DAY_MS + 1000,
        subjectKey: "1",
      });
    }

    const tl = buildCollectionTimeline(baseOpts({ log }));
    const last = tl.past[tl.past.length - 1];
    // Introduced must be 1 (driven by name card).
    expect(last.introduced).toBe(1);
    // Species mastery must be 1 after both legs clear the gate.
    expect(last.mastered).toBe(1);
  });

  it("name-only grades do NOT produce species mastery (reverse leg absent, #1448)", () => {
    // Without a reverse card grade, species mastery cannot be achieved.
    const log: GradeLogEntry[] = [];
    const baseTime = NOW_MS - 50 * DAY_MS;
    const grades: Array<[GradeLogEntry["grade"], number]> = [
      [4, 0], [4, 0], [4, 1], [4, 8], [4, 20],
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
    expect(last.introduced).toBe(1);
    expect(last.mastered).toBe(0);
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

  // -------------------------------------------------------------------------
  // Missing scenarios from issue #1018
  // -------------------------------------------------------------------------

  it("single-entry log: produces exactly one introduced species", () => {
    // A log with a single valid name entry should yield introduced=1.
    const log = [makeEntry("1", 4, 0)];
    const tl = buildCollectionTimeline(baseOpts({ log, totalSpecies: 5 }));
    expect(tl.past.length).toBeGreaterThan(0);
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(1);
    expect(tl.totalSpecies).toBe(5);
  });

  it("log with date gaps: checkpoints bridge the gap correctly", () => {
    // Two species introduced 35 and 7 days ago - both are within the daily
    // resolution window (90 days), so the checkpoints between them must show
    // introduced=1 for entries between the two events.
    const earlyMs = NOW_MS - 35 * DAY_MS; // 5 weeks ago
    const lateMs = NOW_MS - 7 * DAY_MS;   // 1 week ago

    const log: GradeLogEntry[] = [
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: earlyMs, subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: lateMs,  subjectKey: "2" },
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));

    // Find a checkpoint between earlyMs and lateMs.
    const midSnap = tl.past.find(
      (s) => s.atMs > earlyMs && s.atMs < lateMs,
    );
    expect(midSnap).toBeDefined();
    // Only species "1" was introduced before the gap - species "2" comes later.
    expect(midSnap!.introduced).toBe(1);

    // The final snapshot must show both species.
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(2);
  });

  it("duplicate same-day entries for a species count as one introduction", () => {
    // Multiple entries for the same species on the same day should not
    // inflate the introduced count beyond 1.
    const sameTime = NOW_MS - 10 * DAY_MS;
    const log: GradeLogEntry[] = [
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: sameTime,     subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: sameTime + 1, subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: sameTime + 2, subjectKey: "1" },
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(1);
  });

  it("6-day-streak user: at least one snapshot per active day between first and last activity", () => {
    // Simulates a user who reviewed cards on 6 consecutive distinct days.
    // Each day should produce at least one snapshot (daily resolution).
    const log: GradeLogEntry[] = [];
    for (let d = 5; d >= 0; d--) {
      log.push({
        date: "2026-01-01",
        grade: 4,
        cardType: "name",
        occurredAt: NOW_MS - d * DAY_MS - 3600_000, // 1 hour before midnight each day
        subjectKey: String(d + 1),
      });
    }

    const tl = buildCollectionTimeline(baseOpts({ log }));

    // Should have at least 6 distinct snapshot dates between the earliest activity and now.
    const firstActivityMs = log[0].occurredAt;
    const relevantSnaps = tl.past.filter(
      (s) => s.atMs >= firstActivityMs - DAY_MS, // allow one day of slack for midnight alignment
    );
    const uniqueDates = new Set(
      relevantSnaps.map((s) => new Date(s.atMs).toISOString().slice(0, 10)),
    );
    expect(uniqueDates.size).toBeGreaterThanOrEqual(6);

    // The final snapshot must show all 6 species introduced.
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(6);
  });

  it("past timeline: history older than 90 days uses weekly resolution, recent uses daily", () => {
    // One species introduced 120 days ago (in the weekly region) and one
    // 10 days ago (in the daily region). The total snapshot count must be
    // well below 120 (weekly for old history) rather than 120+ (daily for all).
    const oldMs = NOW_MS - 120 * DAY_MS;
    const recentMs = NOW_MS - 10 * DAY_MS;

    const log: GradeLogEntry[] = [
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: oldMs,    subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: recentMs, subjectKey: "2" },
    ];
    const tl = buildCollectionTimeline(baseOpts({ log }));

    // Total entries must be bounded - 120 daily entries would be excessive.
    // Expect roughly: ~4-5 weekly entries (weeks 1-4 of older history) +
    // ~90 daily entries = well under 150 total.
    expect(tl.past.length).toBeLessThan(150);
    // But there must be daily granularity in the last 10 days: at least
    // 8 snapshots in the last 10 days (allows for boundary alignment).
    const last10DaysSnaps = tl.past.filter(
      (s) => s.atMs >= NOW_MS - 12 * DAY_MS,
    );
    expect(last10DaysSnaps.length).toBeGreaterThanOrEqual(8);

    // The final snapshot shows both species.
    const last = tl.past[tl.past.length - 1];
    expect(last.introduced).toBe(2);
  });

  it("nowMs is always the final entry in the past array", () => {
    const log = [makeEntry("1", 4, 0)];
    const tl = buildCollectionTimeline(baseOpts({ log }));
    expect(tl.past.length).toBeGreaterThan(0);
    const last = tl.past[tl.past.length - 1];
    expect(last.atMs).toBe(NOW_MS);
  });

  it("mastery achieved then lapsed: mastered status is not revoked in reconstruction (#1448)", () => {
    // After a species reaches mastery (both legs), the design decision is that
    // once masteredAtMs is set it is never cleared, even if a subsequent Again
    // grade causes a lapse. Both legs receive the same graduation sequence.
    const baseTime = NOW_MS - 50 * DAY_MS;
    const makeLog = (cardType: GradeLogEntry["cardType"], timeOffset = 0): GradeLogEntry[] => [
      { date: "2026-01-01", grade: 4, cardType, occurredAt: baseTime + timeOffset,                subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType, occurredAt: baseTime + DAY_MS + timeOffset,       subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType, occurredAt: baseTime + 2 * DAY_MS + timeOffset,   subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType, occurredAt: baseTime + 9 * DAY_MS + timeOffset,   subjectKey: "1" },
      { date: "2026-01-01", grade: 4, cardType, occurredAt: baseTime + 20 * DAY_MS + timeOffset,  subjectKey: "1" },
    ];
    const log: GradeLogEntry[] = [...makeLog("name"), ...makeLog("reverse", 500)];

    // Verify this sequence achieves species mastery (both legs) before appending the lapse.
    const tlBeforeLapse = buildCollectionTimeline(baseOpts({ log }));
    const lastBeforeLapse = tlBeforeLapse.past[tlBeforeLapse.past.length - 1];
    expect(lastBeforeLapse.mastered).toBe(1);

    // Append a lapse (Again) on the name card after mastery.
    const logWithLapse: GradeLogEntry[] = [
      ...log,
      { date: "2026-01-01", grade: 1, cardType: "name", occurredAt: baseTime + 25 * DAY_MS, subjectKey: "1" },
    ];

    const tlAfterLapse = buildCollectionTimeline(baseOpts({ log: logWithLapse }));
    const lastAfterLapse = tlAfterLapse.past[tlAfterLapse.past.length - 1];

    // Mastery must not be revoked by the lapse.
    expect(lastAfterLapse.introduced).toBe(1);
    expect(lastAfterLapse.mastered).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildCollectionTimeline - future direction
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline - future direction", () => {
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
    // lastReview=2026-02-28, so forgetMs ≈ 2026-03-01T00:00:00Z which is
    // already past NOW_MS=2026-03-01T12:00:00Z - the card is already forgotten
    // at day 0 and all future snapshots should show mastered=0 (F19).
    const state = makeState({
      stability: 1,
      lastReview: "2026-02-28",
      dueDate: "2026-02-28",
    });
    const cards = new Map([["1", state]]);
    const tl = buildCollectionTimeline(baseOpts({ currentNameCards: cards }));
    // The card should be forgotten from day 0 onwards.
    expect(tl.future[0].mastered).toBe(0);
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

describe("buildCollectionTimeline - forceAllMastered", () => {
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

  it("position is clamped - out-of-range values don't throw", () => {
    const tl = makeFakeTl();
    expect(() => snapshotAtPosition(tl, -999)).not.toThrow();
    expect(() => snapshotAtPosition(tl, 999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-locale replay isolation (#1851)
// ---------------------------------------------------------------------------

describe("buildCollectionTimeline locale isolation (#1851)", () => {
  it("excludes other locales' grade-log entries from the replay", () => {
    // Four Easy grades on species 1, all stamped ja. Same subjectKey as a
    // would-be en card - before #1851 the replay merged both locales' grades
    // into one FSRS stream.
    const jaLog = [0, 7, 16, 30].map((offset) => ({
      ...makeEntry("1", 5, offset),
      locale: "ja" as const,
    }));

    const underEn = buildCollectionTimeline(baseOpts({ log: jaLog }));
    const emptyLog = buildCollectionTimeline(baseOpts({}));
    // Under the en locale the ja entries are invisible: identical past
    // timeline to an empty log.
    expect(underEn.past).toEqual(emptyLog.past);

    // Under ja the same entries drive the replay.
    const underJa = buildCollectionTimeline(baseOpts({ log: jaLog, locale: "ja" }));
    expect(underJa.past).not.toEqual(emptyLog.past);
  });
});

// ---------------------------------------------------------------------------
// buildSpeciesMasteryDates (#1956, rescoped: derive, don't store)
// ---------------------------------------------------------------------------

function masteryDatesOpts(
  extra: Partial<SpeciesMasteryDatesOptions> = {},
): SpeciesMasteryDatesOptions {
  return { log: [], locale: "en", ...extra };
}

/** Both legs' graduation sequence used by the #1448 tests above, reused here
 * so a species crosses species-level mastery (both name + reverse) at the
 * final offset in `offsets`. */
function makeGraduationLog(
  subjectKey: string,
  baseTime: number,
  offsets: number[],
  reverseTimeOffsetMs = 500,
): GradeLogEntry[] {
  const nameLog = offsets.map((o) => ({
    date: "2026-01-01",
    grade: 4 as GradeLogEntry["grade"],
    cardType: "name" as const,
    occurredAt: baseTime + o * DAY_MS,
    subjectKey,
  }));
  const reverseLog = offsets.map((o) => ({
    date: "2026-01-01",
    grade: 4 as GradeLogEntry["grade"],
    cardType: "reverse" as const,
    occurredAt: baseTime + o * DAY_MS + reverseTimeOffsetMs,
    subjectKey,
  }));
  return [...nameLog, ...reverseLog];
}

describe("buildSpeciesMasteryDates", () => {
  it("returns an empty map for an empty log (not-mastered state, no crossing)", () => {
    const result = buildSpeciesMasteryDates(masteryDatesOpts());
    expect(result.size).toBe(0);
  });

  it("reports a recoverable crossing date for a species that reaches mastery (both legs)", () => {
    const baseTime = NOW_MS - 50 * DAY_MS;
    const log = makeGraduationLog("1", baseTime, [0, 1, 2, 9, 20]);
    const result = buildSpeciesMasteryDates(masteryDatesOpts({ log }));
    expect(result.has(1)).toBe(true);
    expect(result.get(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("omits a species with no recoverable crossing (name-only grades, reverse leg absent)", () => {
    const baseTime = NOW_MS - 50 * DAY_MS;
    const log: GradeLogEntry[] = [0, 1, 2, 9, 20].map((o) => ({
      date: "2026-01-01",
      grade: 4,
      cardType: "name",
      occurredAt: baseTime + o * DAY_MS,
      subjectKey: "1",
    }));
    const result = buildSpeciesMasteryDates(masteryDatesOpts({ log }));
    expect(result.has(1)).toBe(false);
  });

  it("reports the MOST RECENT crossing, not the first, after a lapse then re-mastery", () => {
    const baseTime = NOW_MS - 100 * DAY_MS;
    // First graduation, crossing around day 20.
    const firstMastery = makeGraduationLog("1", baseTime, [0, 1, 2, 9, 20]);
    // Lapse the name leg (Again) at day 25 - drops stability below the
    // mastery threshold (verified: this specific offset/grade sequence is
    // the same one used by the #1448 "not revoked" aggregate test).
    const lapse: GradeLogEntry = {
      date: "2026-01-01",
      grade: 1,
      cardType: "name",
      occurredAt: baseTime + 25 * DAY_MS,
      subjectKey: "1",
    };
    // Re-graduate the name leg; the reverse leg never lapsed, so the species
    // re-crosses mastery on the name leg's final Good grade at day 55.
    const reGraduateName: GradeLogEntry[] = [26, 27, 28, 35, 55].map((o) => ({
      date: "2026-01-01",
      grade: 4,
      cardType: "name",
      occurredAt: baseTime + o * DAY_MS,
      subjectKey: "1",
    }));
    const log = [...firstMastery, lapse, ...reGraduateName];

    const firstOnly = buildSpeciesMasteryDates(
      masteryDatesOpts({ log: firstMastery }),
    );
    const withLapse = buildSpeciesMasteryDates(masteryDatesOpts({ log }));

    expect(firstOnly.has(1)).toBe(true);
    expect(withLapse.has(1)).toBe(true);
    // The re-crossing date must be later than the first crossing date - the
    // badge is true again because of the day-55 run, not the day-20 run.
    expect(withLapse.get(1)! > firstOnly.get(1)!).toBe(true);
  });

  it("degrades gracefully to an empty map under the superuser pretendAllMastered flag", () => {
    const baseTime = NOW_MS - 50 * DAY_MS;
    const log = makeGraduationLog("1", baseTime, [0, 1, 2, 9, 20]);
    const result = buildSpeciesMasteryDates(
      masteryDatesOpts({ log, forceAllMastered: true }),
    );
    // No real crossing exists under the flag - never fabricate a date.
    expect(result.size).toBe(0);
  });

  it("respects locale isolation - entries from another locale do not leak in (#1851)", () => {
    const baseTime = NOW_MS - 50 * DAY_MS;
    const jaLog = makeGraduationLog("1", baseTime, [0, 1, 2, 9, 20]).map((e) => ({
      ...e,
      locale: "ja" as const,
    }));
    const underEn = buildSpeciesMasteryDates(masteryDatesOpts({ log: jaLog }));
    expect(underEn.size).toBe(0);
    const underJa = buildSpeciesMasteryDates(
      masteryDatesOpts({ log: jaLog, locale: "ja" }),
    );
    expect(underJa.has(1)).toBe(true);
  });
});
