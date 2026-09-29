import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import {
  GRADE_LOG_REPUSH_BATCH_SIZE,
  GRADE_LOG_REPUSH_MAX_REQUESTS_PER_CYCLE,
  GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE,
  resetRejectedGradeLogRepush,
  repushLocalGradeLog,
  selectRepushEntries,
} from "./gradeLogRepush";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { HELD_COPY_STALE_MS } from "@/lib/sync/heldGrade";

const isHeld = vi.fn((_occurredAt: number) => false);
vi.mock("@/lib/gradelog/persistence", () => ({
  isCloudPushHeld: (n: number) => isHeld(n),
}));

vi.mock("@/lib/sync/gradeLog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/gradeLog")>("@/lib/sync/gradeLog");
  return { ...actual, pushGradeLog: vi.fn().mockResolvedValue(true) };
});

const mockPush = vi.mocked(pushGradeLog);
const NOW = 1_790_000_000_000;
const OLD = NOW - HELD_COPY_STALE_MS - 1_000;

function entry(occurredAt: number, over: Partial<GradeLogEntry> = {}): GradeLogEntry {
  return { occurredAt, date: "2026-09-29", cardType: "name", grade: 4, subjectKey: "25", ...over };
}
const client = {} as SupabaseClient;

beforeEach(() => {
  resetRejectedGradeLogRepush();
  isHeld.mockReturnValue(false);
  mockPush.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("selectRepushEntries", () => {
  it("returns local entries the cloud lacks", () => {
    const out = selectRepushEntries([entry(OLD), entry(OLD + 1)], [entry(OLD)], { lastResetAt: null, now: NOW });
    expect(out.map((e) => e.occurredAt)).toEqual([OLD + 1]);
  });

  it("returns nothing when local is empty (empty side)", () => {
    expect(selectRepushEntries([], [entry(OLD)], { lastResetAt: null, now: NOW })).toEqual([]);
  });

  it("returns everything when the cloud is empty (populated side)", () => {
    const out = selectRepushEntries([entry(OLD), entry(OLD + 1)], [], { lastResetAt: null, now: NOW });
    expect(out).toHaveLength(2);
  });

  it("excludes entries still held for undo in this tab", () => {
    isHeld.mockImplementation((n) => n === OLD);
    const out = selectRepushEntries([entry(OLD), entry(OLD + 1)], [], { lastResetAt: null, now: NOW });
    expect(out.map((e) => e.occurredAt)).toEqual([OLD + 1]);
  });

  it("defers entries newer than the longest live hold (another tab may hold them)", () => {
    const fresh = NOW - HELD_COPY_STALE_MS + 1;
    const out = selectRepushEntries([entry(fresh)], [], { lastResetAt: null, now: NOW });
    expect(out).toEqual([]);
  });

  it("excludes entries dated before last_reset_at (UTC date) and keeps same-day ones", () => {
    const out = selectRepushEntries(
      [entry(OLD, { date: "2026-09-27" }), entry(OLD + 1, { date: "2026-09-28" }), entry(OLD + 2, { date: "2026-09-29" })],
      [],
      { lastResetAt: "2026-09-28T15:30:00+00:00", now: NOW },
    );
    expect(out.map((e) => e.occurredAt)).toEqual([OLD + 1, OLD + 2]);
  });

  it("uses the UTC date of a non-UTC last_reset_at offset", () => {
    // 2026-09-29T01:00+05:00 is 2026-09-28T20:00Z, so the cutoff is 2026-09-28.
    const out = selectRepushEntries([entry(OLD, { date: "2026-09-28" })], [], {
      lastResetAt: "2026-09-29T01:00:00+05:00",
      now: NOW,
    });
    expect(out).toHaveLength(1);
  });

  it("ignores an unparseable last_reset_at rather than dropping everything", () => {
    const out = selectRepushEntries([entry(OLD)], [], { lastResetAt: "garbage", now: NOW });
    expect(out).toHaveLength(1);
  });

  it("excludes entries that fail isGradeLogEntry (legacy without subjectKey, bad grade)", () => {
    const legacy: GradeLogEntry = { occurredAt: OLD, date: "2026-09-29", cardType: "name", grade: 4 };
    const badGrade = entry(OLD + 1, { grade: 3 as GradeLogEntry["grade"] });
    const out = selectRepushEntries([legacy, badGrade, entry(OLD + 2)], [], { lastResetAt: null, now: NOW });
    expect(out.map((e) => e.occurredAt)).toEqual([OLD + 2]);
  });

  it("dedupes local entries sharing an occurredAt", () => {
    const out = selectRepushEntries([entry(OLD), entry(OLD)], [], { lastResetAt: null, now: NOW });
    expect(out).toHaveLength(1);
  });
});

describe("repushLocalGradeLog", () => {
  it("does not call the push helper when there is nothing to send", async () => {
    expect(await repushLocalGradeLog(client, "u", [entry(OLD)], [entry(OLD)], { lastResetAt: null, now: NOW })).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("batches to the cap per request", async () => {
    const n = GRADE_LOG_REPUSH_BATCH_SIZE * 2 + 5;
    const local = Array.from({ length: n }, (_, i) => entry(OLD - i));
    const pushed = await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    expect(pushed).toBe(n);
    expect(mockPush.mock.calls.map((c) => c[2].length)).toEqual([
      GRADE_LOG_REPUSH_BATCH_SIZE,
      GRADE_LOG_REPUSH_BATCH_SIZE,
      5,
    ]);
  });

  it("bisects a failed batch so one poisoned row does not block the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const poison = OLD - 3;
    const local = Array.from({ length: 8 }, (_, i) => entry(OLD - i));
    const landed: number[] = [];
    mockPush.mockImplementation(async (_c, _u, rows) => {
      if (rows.some((r) => r.occurredAt === poison)) return false;
      landed.push(...rows.map((r) => r.occurredAt));
      return true;
    });
    const pushed = await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    expect(pushed).toBe(7);
    expect(landed.sort()).toEqual(local.map((e) => e.occurredAt).filter((t) => t !== poison).sort());
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("skips a row rejected as a single request on the next cycle in the same session", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const poison = OLD - 1;
    const local = [entry(OLD), entry(poison), entry(OLD - 2)];
    mockPush.mockImplementation(async (_c, _u, rows) => !rows.some((r) => r.occurredAt === poison));
    await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    mockPush.mockClear();
    mockPush.mockResolvedValue(true);
    const pushed = await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    expect(pushed).toBe(2);
    expect(mockPush.mock.calls.flatMap((c) => c[2].map((r) => r.occurredAt))).not.toContain(poison);
    warn.mockRestore();
  });

  it("does not blacklist rows when every request fails (offline) and stops early", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPush.mockResolvedValue(false);
    const local = Array.from({ length: 50 }, (_, i) => entry(OLD - i));
    expect(await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW })).toBe(0);
    expect(mockPush.mock.calls.length).toBeLessThan(GRADE_LOG_REPUSH_MAX_REQUESTS_PER_CYCLE);
    mockPush.mockClear();
    mockPush.mockResolvedValue(true);
    expect(await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW })).toBe(50);
    warn.mockRestore();
  });

  it("caps rows per cycle, oldest first, and drains the rest on the next cycle", async () => {
    const n = GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE + 30;
    const local = Array.from({ length: n }, (_, i) => entry(OLD - i));
    const first = await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    expect(first).toBe(GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE);
    const sent = mockPush.mock.calls.flatMap((c) => c[2].map((r) => r.occurredAt));
    expect(Math.min(...sent)).toBe(OLD - (GRADE_LOG_REPUSH_MAX_ROWS_PER_CYCLE - 1) - 30);
    // Second cycle: cloud now has those; the remainder (the newest 30) goes.
    const cloud = local.filter((e) => sent.includes(e.occurredAt));
    mockPush.mockClear();
    expect(await repushLocalGradeLog(client, "u", local, cloud, { lastResetAt: null, now: NOW })).toBe(30);
  });

  it("bounds requests per cycle including bisection retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // First request succeeds (so bisection is allowed), everything after fails.
    mockPush.mockResolvedValueOnce(true).mockResolvedValue(false);
    const local = Array.from({ length: 600 }, (_, i) => entry(OLD - i));
    await repushLocalGradeLog(client, "u", local, [], { lastResetAt: null, now: NOW });
    expect(mockPush.mock.calls.length).toBeLessThanOrEqual(GRADE_LOG_REPUSH_MAX_REQUESTS_PER_CYCLE);
    warn.mockRestore();
  });
});
