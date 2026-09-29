/**
 * Integration test: the grade_log divergence monitor's SQL (#2096).
 *
 * `.github/scripts/check-grade-log-divergence.mjs` runs three queries against
 * prod via the Supabase Management API. This file runs the SAME query strings
 * (imported, not copied) against the local Postgres with every migration
 * applied, so the graduation signal and the locale join are checked against
 * the real schema.
 *
 * The bug this pins (#2096): Options A and C treated `MAX(grade) >= 4` as
 * "graduated". A Good on a brand-new card only enters learning step 0
 * (scheduler case A1), so cards still inside their learning steps, which
 * `isSyncSafe()` deliberately keeps out of card_reviews, were flagged as
 * orphans. The graduation signal is now a grade_log row with
 * `learning_step IS NULL` (`learning_step` is the step AFTER the grade,
 * #1416), whatever the grade: a Hard on a graduated card stays graduated
 * (scheduler case A4). This assumes every row in the look-back window was
 * written after #1416; on older rows NULL only means "not recorded".
 *
 * Dates are written as `CURRENT_DATE - n` in SQL rather than computed in JS,
 * so they share the query's own notion of "today" whatever the host timezone.
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
  OPTION_A_QUERY,
  OPTION_B_QUERY,
  OPTION_C_QUERY,
} from "../../../.github/scripts/check-grade-log-divergence.mjs";

let pool: pg.Pool;
let dbName: string;

const USER_ID = randomUUID();
let occurredAtSeq = 1_700_000_000_000;

type Grade = { grade: 1 | 2 | 4 | 5; step: number | null };

/** Insert grade_log rows for one subject, in order, `daysAgo` days back. */
async function insertGrades(opts: {
  grades: Grade[];
  daysAgo: number;
  subjectKey?: string;
  cardType?: string;
  locale?: string;
}): Promise<void> {
  for (const g of opts.grades) {
    occurredAtSeq += 1;
    await pool.query(
      `INSERT INTO grade_log
         (user_id, occurred_at, entry_date, card_type, subject_key, locale,
          grade, learning_step)
       VALUES ($1, $2, CURRENT_DATE - $3::int, $4, $5, $6, $7, $8)`,
      [
        USER_ID,
        occurredAtSeq,
        opts.daysAgo,
        opts.cardType ?? "name",
        opts.subjectKey ?? "25",
        opts.locale ?? "en",
        g.grade,
        g.step,
      ],
    );
  }
}

/** Insert a card_reviews row. `stuck` gives the Option B stuck shape. */
async function insertCardReview(opts: {
  subjectKey?: string;
  cardType?: string;
  locale?: string;
  stuck?: boolean;
}): Promise<void> {
  const stuck = opts.stuck ?? false;
  await pool.query(
    `INSERT INTO card_reviews
       (user_id, card_type, subject_key, locale,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        seen_in_pasture, updated_at)
     VALUES ($1, $2, $3, $4,
             2.0, 5.0, 1, 7,
             $5, 0, 'review',
             CURRENT_DATE + 7, $6::date, CURRENT_DATE - 3,
             false, now())`,
    [
      USER_ID,
      opts.cardType ?? "name",
      opts.subjectKey ?? "25",
      opts.locale ?? "en",
      stuck ? 0 : 2,
      stuck ? null : new Date().toISOString().slice(0, 10),
    ],
  );
}

/** Run a monitor query and return the flagged count for the test user. */
async function flagged(query: string, column: string): Promise<number> {
  const res = await pool.query(query);
  const row = res.rows.find((r) => r.user_id === USER_ID);
  return row ? Number(row[column]) : 0;
}

const optionA = () => flagged(OPTION_A_QUERY, "missing_subjects");
const optionB = () => flagged(OPTION_B_QUERY, "stuck_subjects");
const optionC = () => flagged(OPTION_C_QUERY, "graduated_orphan_subjects");

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
  await pool.query(`DELETE FROM card_reviews WHERE user_id = $1`, [USER_ID]);
  await pool.query(`DELETE FROM grade_log WHERE user_id = $1`, [USER_ID]);
});

describe("grade_log divergence monitor: Option C (graduated orphan, no grace)", () => {
  it("does NOT flag a new card graded Good once (4@0, still in learning step 0)", async () => {
    await insertGrades({ grades: [{ grade: 4, step: 0 }], daysAgo: 0 });
    expect(await optionC()).toBe(0);
  });

  it("does NOT flag a new card graded Good twice (4@0, 4@1, still in step 1)", async () => {
    await insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
      ],
      daysAgo: 0,
    });
    expect(await optionC()).toBe(0);
  });

  it("does NOT flag a card the user keeps failing (1@0, 2@0)", async () => {
    await insertGrades({
      grades: [
        { grade: 1, step: 0 },
        { grade: 2, step: 0 },
      ],
      daysAgo: 0,
    });
    expect(await optionC()).toBe(0);
  });

  it("flags a graduated grade (4@null) with no card_reviews row", async () => {
    await insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
        { grade: 4, step: null },
      ],
      daysAgo: 0,
    });
    expect(await optionC()).toBe(1);
  });

  it("flags Easy on a new card (5@null graduates immediately) with no card_reviews row", async () => {
    await insertGrades({ grades: [{ grade: 5, step: null }], daysAgo: 0 });
    expect(await optionC()).toBe(1);
  });

  it("does NOT flag a graduated grade when the card_reviews row exists", async () => {
    await insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0 });
    await insertCardReview({});
    expect(await optionC()).toBe(0);
  });

  it("flags a graduated-then-lapsed subject (4@null then 1@0) with no card_reviews row", async () => {
    // lastReview stays set through relearning, so isSyncSafe() is true and
    // the row should exist: the latest row being in-step must not hide it.
    await insertGrades({
      grades: [
        { grade: 4, step: null },
        { grade: 1, step: 0 },
      ],
      daysAgo: 0,
    });
    expect(await optionC()).toBe(1);
  });

  it("flags a graduated card reviewed Hard (2@null, case A4) with no card_reviews row", async () => {
    // A Hard on a graduated card keeps it graduated, so the NULL step is a real
    // graduation signal whatever the grade. A `grade >= 4` filter would hide it.
    await insertGrades({ grades: [{ grade: 2, step: null }], daysAgo: 0 });
    expect(await optionC()).toBe(1);
  });

  it("joins on locale: a row in another locale does not mask the orphan", async () => {
    await insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0, locale: "ja" });
    await insertCardReview({ locale: "en" });
    expect(await optionC()).toBe(1);
  });

  it("flags a graduated evolution card with no card_reviews row", async () => {
    await insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "evolution",
      subjectKey: "1>>>2",
    });
    expect(await optionC()).toBe(1);
  });

  it("normalises reverse-evolution card_type to the card_reviews vocabulary (#970)", async () => {
    await insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "reverse-evolution",
      subjectKey: "1>>>2",
    });
    await insertCardReview({ cardType: "reverse-evolution-edge", subjectKey: "1>>>2" });
    expect(await optionC()).toBe(0);
  });

  it("flags a graduated reverse-evolution card with no card_reviews row", async () => {
    await insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "reverse-evolution",
      subjectKey: "1>>>2",
    });
    expect(await optionC()).toBe(1);
  });

  it("normalises evolution card_type to the card_reviews vocabulary (#970)", async () => {
    await insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "evolution",
      subjectKey: "1>>>2",
    });
    await insertCardReview({ cardType: "evolution-edge", subjectKey: "1>>>2" });
    expect(await optionC()).toBe(0);
  });
});

describe("grade_log divergence monitor: Option A (row never written, 2-day grace)", () => {
  it("does NOT flag an abandoned new card graded Good once 3 days ago (4@0)", async () => {
    await insertGrades({ grades: [{ grade: 4, step: 0 }], daysAgo: 3 });
    expect(await optionA()).toBe(0);
  });

  it("does NOT flag an abandoned card graded 4@0, 4@1 3 days ago", async () => {
    await insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
      ],
      daysAgo: 3,
    });
    expect(await optionA()).toBe(0);
  });

  it("flags a card that graduated 3 days ago (4@null) with no card_reviews row", async () => {
    await insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 3 });
    expect(await optionA()).toBe(1);
  });

  it("flags a graduated card reviewed Hard 3 days ago (2@null, case A4) with no card_reviews row", async () => {
    await insertGrades({ grades: [{ grade: 2, step: null }], daysAgo: 3 });
    expect(await optionA()).toBe(1);
  });

  it("does NOT flag a graduated card inside the 2-day grace (Option C's job)", async () => {
    await insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0 });
    expect(await optionA()).toBe(0);
  });

  it("joins on locale: a row in another locale does not mask the orphan", async () => {
    await insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 3, locale: "zh-Hans" });
    await insertCardReview({ locale: "en" });
    expect(await optionA()).toBe(1);
  });
});

describe("grade_log divergence monitor: Option B (row stuck stale)", () => {
  const threeGrades: Grade[] = [
    { grade: 4, step: 0 },
    { grade: 4, step: 1 },
    { grade: 4, step: null },
  ];

  it("flags a stuck row in the same locale as >=3 grades", async () => {
    await insertGrades({ grades: threeGrades, daysAgo: 3 });
    await insertCardReview({ stuck: true });
    expect(await optionB()).toBe(1);
  });

  it("does NOT pair grades in one locale with a stuck row in another", async () => {
    await insertGrades({ grades: threeGrades, daysAgo: 3, locale: "ja" });
    await insertCardReview({ stuck: true, locale: "en" });
    expect(await optionB()).toBe(0);
  });
});
