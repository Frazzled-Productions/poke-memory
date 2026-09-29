/**
 * Integration test: the `/api/sync` beacon grade_log leg against the real
 * `grade_log` table (#2052).
 *
 * The route maps each validated entry with `toGradeLogDbRow` and upserts with
 * `onConflict: GRADE_LOG_CONFLICT_COLS, ignoreDuplicates: true`. PostgREST
 * turns that into `INSERT ... ON CONFLICT (user_id, occurred_at) DO NOTHING`;
 * this test issues that exact statement (column list built from the mapper's
 * own keys and the exported conflict constant) so a schema or mapping drift
 * fails here rather than silently dropping the row in production.
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
  isGradeLogEntry,
  toGradeLogDbRow,
} from "@/lib/sync/gradeLog";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

let pool: pg.Pool;
let dbName: string;

const USER_ID = randomUUID();

/** Emulates PostgREST's `upsert(rows, { onConflict, ignoreDuplicates: true })`. */
async function upsertIgnoreDuplicates(entries: GradeLogEntry[]): Promise<void> {
  for (const entry of entries) {
    const row = toGradeLogDbRow(USER_ID, entry);
    const cols = Object.keys(row);
    const values = Object.values(row);
    await pool.query(
      `INSERT INTO grade_log (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (${GRADE_LOG_CONFLICT_COLS.split(",").join(", ")}) DO NOTHING`,
      values,
    );
  }
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
});

describe("beacon grade_log leg vs the real grade_log table (#2052)", () => {
  const entry: GradeLogEntry = {
    occurredAt: 1_790_000_000_000,
    date: "2026-09-29",
    grade: 4,
    cardType: "name",
    subjectKey: "25",
    locale: "ja",
    learningStep: 1,
    stepStartedAt: 1_789_999_999_000,
  };

  it("a committed held grade's entry lands with every column mapped", async () => {
    expect(isGradeLogEntry(entry)).toBe(true);
    await upsertIgnoreDuplicates([entry]);

    const { rows } = await pool.query(
      `SELECT occurred_at::float8 AS occurred_at, entry_date::text AS entry_date,
              card_type, grade, subject_key, locale, learning_step,
              step_started_at::float8 AS step_started_at
         FROM grade_log WHERE user_id = $1`,
      [USER_ID],
    );
    expect(rows).toEqual([
      {
        occurred_at: entry.occurredAt,
        entry_date: "2026-09-29",
        card_type: "name",
        grade: 4,
        subject_key: "25",
        locale: "ja",
        learning_step: 1,
        step_started_at: entry.stepStartedAt,
      },
    ]);
  });

  it("re-sending the same entry (beacon retry / SW replay) is a no-op, not an error", async () => {
    await upsertIgnoreDuplicates([entry]);
    await upsertIgnoreDuplicates([entry, { ...entry, grade: 1 }]);

    const { rows } = await pool.query(
      `SELECT grade FROM grade_log WHERE user_id = $1`,
      [USER_ID],
    );
    expect(rows).toEqual([{ grade: 4 }]); // first write wins
  });

  it("a minimal entry (graduated card, no optional fields) maps NULLs and locale 'en'", async () => {
    const minimal: GradeLogEntry = {
      occurredAt: 1_790_000_000_001,
      date: "2026-09-29",
      grade: 5,
      cardType: "reverse-evolution",
      subjectKey: "1>>>2",
    };
    expect(isGradeLogEntry(minimal)).toBe(true);
    await upsertIgnoreDuplicates([minimal]);

    const { rows } = await pool.query(
      `SELECT card_type, subject_key, locale, learning_step, step_started_at
         FROM grade_log WHERE user_id = $1 AND occurred_at = $2`,
      [USER_ID, minimal.occurredAt],
    );
    expect(rows).toEqual([
      {
        card_type: "reverse-evolution",
        subject_key: "1>>>2",
        locale: "en",
        learning_step: null,
        step_started_at: null,
      },
    ]);
  });

  it("an entry without subjectKey is rejected by the boundary validator because the column is NOT NULL", async () => {
    const legacy: GradeLogEntry = {
      occurredAt: 1_790_000_000_002,
      date: "2026-09-29",
      grade: 5,
      cardType: "name",
    };
    // The validator drops it before it can poison a batch...
    expect(isGradeLogEntry(legacy)).toBe(false);
    // ...because the real table would reject it (pins the reason for the rule).
    await expect(upsertIgnoreDuplicates([legacy])).rejects.toThrow(/subject_key/);
  });

  it("every card type the boundary validator accepts is accepted by the table", async () => {
    const types: GradeLogEntry["cardType"][] = [
      "name",
      "evolution",
      "reverse-evolution",
      "reverse",
      "cry",
    ];
    for (const [i, cardType] of types.entries()) {
      const e: GradeLogEntry = {
        occurredAt: 1_790_000_100_000 + i,
        date: "2026-09-29",
        grade: 2,
        cardType,
        subjectKey: "1",
      };
      expect(isGradeLogEntry(e)).toBe(true);
      await upsertIgnoreDuplicates([e]);
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM grade_log WHERE user_id = $1`,
      [USER_ID],
    );
    expect(rows[0].n).toBe(types.length);
  });
});
