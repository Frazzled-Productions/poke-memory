/**
 * The grade-log re-push leg (#2117) against the real grade_log table and the
 * 022 pre-reset trigger on D1, through the real data client and gateway.
 * Ported from the Postgres suite (lib/sync/integration/grade-log-repush.test.ts).
 *
 * pushGradeLog upserts the whole batch at once (one atomic D1 batch, as it was
 * one Postgres statement). A single row the trigger rejects aborts the whole
 * batch, which is why selectRepushEntries filters them out.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";
import { createGatewayTestClient } from "./testing/gatewayClient";
import type { DataClient } from "./client";
import { pushGradeLogDetailed } from "@/lib/sync/gradeLog";
import { selectRepushEntries } from "@/lib/sync/gradeLogRepush";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

let d1: SqliteD1;
let userId: string;
let db: DataClient;

const NOW = 1_800_000_000_000;
const LONG_AGO = 1_700_000_000_000;

function entry(occurredAt: number, date: string, over: Partial<GradeLogEntry> = {}): GradeLogEntry {
  return { occurredAt, date, cardType: "name", grade: 4, subjectKey: "25", ...over };
}

function stored(): number[] {
  return (
    d1.sqlite.prepare("SELECT occurred_at FROM grade_log WHERE user_id = ? ORDER BY occurred_at").all(userId) as {
      occurred_at: number;
    }[]
  ).map((r) => r.occurred_at);
}

beforeEach(() => {
  d1 = createSqliteD1();
  userId = createTestUser(d1);
  db = createGatewayTestClient(d1, userId);
  d1.sqlite
    .prepare("INSERT INTO user_settings (user_id, last_reset_at) VALUES (?, '2026-09-28T12:00:00.000Z')")
    .run(userId);
});
afterEach(() => d1.close());

describe("grade-log re-push against the real table (#2117)", () => {
  const cloud = entry(LONG_AGO, "2026-09-29");
  const preReset = entry(LONG_AGO + 1, "2026-09-27");
  const fresh1 = entry(LONG_AGO + 2, "2026-09-29");
  const fresh2 = entry(LONG_AGO + 3, "2026-09-28"); // same UTC day as the reset: allowed
  const legacy: GradeLogEntry = { occurredAt: LONG_AGO + 4, date: "2026-09-29", cardType: "name", grade: 4 };

  it("pins the hazard: one pre-reset row aborts the whole unfiltered batch ('rejected', 23514)", async () => {
    expect(await pushGradeLogDetailed(db, userId, [fresh1, preReset])).toBe("rejected");
    expect(stored()).toEqual([]);
  });

  it("a mixed local log re-pushes only the valid new rows and does not fail the batch", async () => {
    expect(await pushGradeLogDetailed(db, userId, [cloud])).toBe("ok");
    const toPush = selectRepushEntries([cloud, preReset, fresh1, fresh2, legacy], [cloud], {
      lastResetAt: "2026-09-28T12:00:00+00:00",
      now: NOW,
    });
    expect(toPush.map((e) => e.occurredAt)).toEqual([fresh1.occurredAt, fresh2.occurredAt]);
    expect(await pushGradeLogDetailed(db, userId, [...toPush, cloud])).toBe("ok");
    expect(stored()).toEqual([cloud.occurredAt, fresh1.occurredAt, fresh2.occurredAt]);
  });

  it("running the leg twice is idempotent", async () => {
    const toPush = selectRepushEntries([fresh1, fresh2], [], { lastResetAt: null, now: NOW });
    expect(await pushGradeLogDetailed(db, userId, toPush)).toBe("ok");
    expect(await pushGradeLogDetailed(db, userId, toPush)).toBe("ok");
    expect(stored()).toHaveLength(2);
  });

  it("a reset just before UTC midnight: the boundary-day entry lands, the day before is refused", async () => {
    const resetAt = "2026-09-28T23:59:59.000Z";
    d1.sqlite.prepare("UPDATE user_settings SET last_reset_at = ? WHERE user_id = ?").run(resetAt, userId);
    const dayBefore = entry(LONG_AGO + 10, "2026-09-27");
    const boundaryDay = entry(LONG_AGO + 11, "2026-09-28");
    const toPush = selectRepushEntries([dayBefore, boundaryDay], [], { lastResetAt: resetAt, now: NOW });
    expect(toPush).toEqual([boundaryDay]);
    expect(await pushGradeLogDetailed(db, userId, toPush)).toBe("ok");
    expect(await pushGradeLogDetailed(db, userId, [dayBefore])).toBe("rejected");
    expect(stored()).toHaveLength(1);
  });
});
