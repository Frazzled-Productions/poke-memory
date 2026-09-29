/**
 * Integration test: the grade-log re-push leg (#2117) against the real
 * `grade_log` table and migration 022's pre-reset trigger.
 *
 * `pushGradeLog` upserts the whole batch as ONE statement
 * (`INSERT ... ON CONFLICT (user_id, occurred_at) DO NOTHING`). A single row
 * the BEFORE INSERT trigger rejects (dated before `last_reset_at`) aborts the
 * whole statement, which is why `selectRepushEntries` filters them out. This
 * test pins both halves: the unfiltered batch fails, and the filtered batch
 * inserts only the valid, new rows while duplicates are silently skipped.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  GRADE_LOG_CONFLICT_COLS,
  toGradeLogDbRow,
} from "@/lib/sync/gradeLog";
import { selectRepushEntries } from "@/lib/sync/gradeLogRepush";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

let pool: pg.Pool;
let dbName: string;

const USER_ID = randomUUID();
const NOW = 1_800_000_000_000;
const LONG_AGO = 1_700_000_000_000;

/** One multi-row statement, as PostgREST issues for `upsert(rows, { ignoreDuplicates })`. */
async function upsertBatch(entries: GradeLogEntry[]): Promise<void> {
  const rows = entries.map((e) => toGradeLogDbRow(USER_ID, e));
  const cols = Object.keys(rows[0]);
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const ph = cols.map((c) => {
      values.push((row as Record<string, unknown>)[c]);
      return `$${values.length}`;
    });
    return `(${ph.join(", ")})`;
  });
  await pool.query(
    `INSERT INTO grade_log (${cols.join(", ")})
     VALUES ${tuples.join(", ")}
     ON CONFLICT (${GRADE_LOG_CONFLICT_COLS.split(",").join(", ")}) DO NOTHING`,
    values,
  );
}

function entry(occurredAt: number, date: string, over: Partial<GradeLogEntry> = {}): GradeLogEntry {
  return { occurredAt, date, cardType: "name", grade: 4, subjectKey: "25", ...over };
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_ID);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

beforeEach(async () => {
  await pool.query(`DELETE FROM grade_log WHERE user_id = $1`, [USER_ID]);
  await pool.query(`DELETE FROM user_settings WHERE user_id = $1`, [USER_ID]);
  await pool.query(
    `INSERT INTO user_settings (user_id, last_reset_at) VALUES ($1, '2026-09-28T12:00:00Z')`,
    [USER_ID],
  );
});

describe("grade-log re-push against the real table (#2117)", () => {
  const cloud = entry(LONG_AGO, "2026-09-29");
  const preReset = entry(LONG_AGO + 1, "2026-09-27");
  const fresh1 = entry(LONG_AGO + 2, "2026-09-29");
  const fresh2 = entry(LONG_AGO + 3, "2026-09-28"); // same UTC day as the reset: allowed
  const legacy: GradeLogEntry = { occurredAt: LONG_AGO + 4, date: "2026-09-29", cardType: "name", grade: 4 };

  it("pins the hazard: one pre-reset row aborts the whole unfiltered batch", async () => {
    await expect(upsertBatch([fresh1, preReset])).rejects.toThrow(/before last_reset_at/);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM grade_log WHERE user_id = $1`, [USER_ID]);
    expect(rows[0].n).toBe(0);
  });

  it("a mixed local log re-pushes only the valid new rows and does not fail the batch", async () => {
    // The cloud already has one row.
    await upsertBatch([cloud]);

    const local = [cloud, preReset, fresh1, fresh2, legacy];
    const toPush = selectRepushEntries(local, [cloud], {
      lastResetAt: "2026-09-28T12:00:00+00:00",
      now: NOW,
    });
    expect(toPush.map((e) => e.occurredAt)).toEqual([fresh1.occurredAt, fresh2.occurredAt]);

    // Include a duplicate of an existing row in the batch too: DO NOTHING skips it.
    await upsertBatch([...toPush, cloud]);

    const { rows } = await pool.query(
      `SELECT occurred_at::float8 AS occurred_at FROM grade_log WHERE user_id = $1 ORDER BY occurred_at`,
      [USER_ID],
    );
    expect(rows.map((r) => r.occurred_at)).toEqual([cloud.occurredAt, fresh1.occurredAt, fresh2.occurredAt]);
  });

  it("running the leg twice is idempotent", async () => {
    const toPush = selectRepushEntries([fresh1, fresh2], [], { lastResetAt: null, now: NOW });
    await upsertBatch(toPush);
    await upsertBatch(toPush);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM grade_log WHERE user_id = $1`, [USER_ID]);
    expect(rows[0].n).toBe(2);
  });
});
