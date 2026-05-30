/**
 * Integration test: reconcile_grade_log_orphans (migration 032).
 *
 * Verifies the conservative placeholder INSERT function that heals sync
 * orphans: graduated grade_log entries with no matching card_reviews row.
 *
 * The function is a SECURITY DEFINER RPC called by pg_cron (not by clients).
 * Tests call it directly via SQL; the pg_cron schedule is not exercised here
 * since the stock postgres:15 CI container may not have pg_cron available.
 *
 * Test scenarios:
 *   1. Dry-run: orphan is detected but no card_reviews row is inserted.
 *   2. Live run: placeholder card_reviews row is inserted with derived
 *      reps / first_seen / last_review and the correct locale.
 *   3. Idempotency: running the live function twice inserts nothing on the
 *      second pass (ON CONFLICT DO NOTHING).
 *   4. Only-Again: a subject with only grade=1 (Again) entries is NOT healed
 *      because MAX(grade) < 4.
 *   5. Existing row: a card_reviews row that already exists is NOT clobbered;
 *      the existing row's values are untouched after a live run.
 *   6. Locale grouping: grade_log entries with different locales for the same
 *      (user_id, card_type, subject_key) produce independent orphan rows.
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

let pool: pg.Pool;
let dbName: string;

const USER_ID = randomUUID();
const USER_ID_2 = randomUUID();

/** Helper: insert one grade_log row for the test user using direct SQL.
 *  Bypasses RLS by running outside a user transaction (pool-level). */
async function insertGradeLogRow(opts: {
  userId: string;
  cardType: string;
  subjectKey: string;
  locale: string;
  grade: number;
  entryDate: string; // 'YYYY-MM-DD'
}): Promise<void> {
  // occurred_at must be unique per (user_id, occurred_at).
  const occurredAt = Date.now() + Math.floor(Math.random() * 1_000_000);
  await pool.query(
    `INSERT INTO grade_log
       (user_id, occurred_at, entry_date, card_type, subject_key, locale, grade)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.userId,
      occurredAt,
      opts.entryDate,
      opts.cardType,
      opts.subjectKey,
      opts.locale,
      opts.grade,
    ],
  );
}

/** Helper: insert a card_reviews row for the test user using direct SQL.
 *  Bypasses RLS by running outside a user transaction (pool-level). */
async function insertCardReview(opts: {
  userId: string;
  cardType: string;
  subjectKey: string;
  locale: string;
  reps?: number;
}): Promise<void> {
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
             CURRENT_DATE + 7, CURRENT_DATE - 1, CURRENT_DATE - 3,
             false, now())`,
    [
      opts.userId,
      opts.cardType,
      opts.subjectKey,
      opts.locale,
      opts.reps ?? 2,
    ],
  );
}

/** Helper: call the reconcile function directly as the postgres superuser. */
async function callReconcile(dryRun: boolean): Promise<void> {
  await pool.query(
    `SELECT public.reconcile_grade_log_orphans(p_dry_run := $1)`,
    [dryRun],
  );
}

/** Helper: fetch card_reviews rows for a given (user_id, subject_key, locale). */
async function getCardReviewRows(
  userId: string,
  subjectKey: string,
  locale: string,
): Promise<Record<string, unknown>[]> {
  const res = await pool.query(
    `SELECT * FROM card_reviews
     WHERE user_id = $1 AND subject_key = $2 AND locale = $3`,
    [userId, subjectKey, locale],
  );
  return res.rows;
}

// Today's date formatted as 'YYYY-MM-DD' using UTC.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  // Satisfy FK constraints on grade_log and card_reviews.
  await insertAuthUser(pool, USER_ID);
  await insertAuthUser(pool, USER_ID_2);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

// Clean up card_reviews and grade_log rows between tests to avoid
// cross-test contamination. grade_log rows use unique occurred_at so
// collisions are impossible, but card_reviews has a unique PK.
beforeEach(async () => {
  await pool.query(`DELETE FROM card_reviews WHERE user_id IN ($1, $2)`, [
    USER_ID,
    USER_ID_2,
  ]);
  await pool.query(`DELETE FROM grade_log WHERE user_id IN ($1, $2)`, [
    USER_ID,
    USER_ID_2,
  ]);
});

describe("reconcile_grade_log_orphans (integration)", () => {
  // ── Test 1: dry-run leaves card_reviews empty ─────────────────────────────
  it("dry-run: detects orphan but does not insert a card_reviews row", async () => {
    // Seed: one successful name review within the 4-day window.
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "25",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(1),
    });

    await callReconcile(true);

    const rows = await getCardReviewRows(USER_ID, "25", "en");
    expect(rows).toHaveLength(0);
  });

  // ── Test 2: live run inserts a placeholder row ────────────────────────────
  it("live run: inserts placeholder card_reviews row with derived reps/first_seen/last_review and correct locale", async () => {
    const firstDate = daysAgo(3);
    const lastDate = daysAgo(1);

    // Two Good grades on different days.
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "1",
      locale: "ja",
      grade: 4,
      entryDate: firstDate,
    });
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "1",
      locale: "ja",
      grade: 4,
      entryDate: lastDate,
    });

    await callReconcile(false);

    const rows = await getCardReviewRows(USER_ID, "1", "ja");
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.card_type).toBe("name");
    expect(row.locale).toBe("ja");
    expect(row.reps).toBe(2); // two grade>=4 entries
    expect(row.lapses).toBe(0); // no Again grades
    expect(String(row.first_seen)).toBe(firstDate);
    expect(String(row.last_review)).toBe(lastDate);
    expect(String(row.due_date)).toBe(today());
    expect(row.fsrs_state).toBe("review");
    expect(row.seen_in_pasture).toBe(false);
    expect(Number(row.stability)).toBeCloseTo(1.0);
    expect(Number(row.difficulty)).toBeCloseTo(5.0);
  });

  // ── Test 3: idempotency ───────────────────────────────────────────────────
  it("live run twice: second run inserts nothing (idempotent via ON CONFLICT DO NOTHING)", async () => {
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "4",
      locale: "en",
      grade: 5,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);
    const afterFirst = await getCardReviewRows(USER_ID, "4", "en");
    expect(afterFirst).toHaveLength(1);

    // Run again — must not throw and must not change the row.
    await callReconcile(false);
    const afterSecond = await getCardReviewRows(USER_ID, "4", "en");
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].updated_at).toEqual(afterFirst[0].updated_at);
  });

  // ── Test 4: only Again grades -- NOT healed ───────────────────────────────
  it("subject with only Again/Hard grades (MAX(grade)<4) is NOT healed", async () => {
    // grade=1 (Again) and grade=2 (Hard) -- neither qualifies.
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "7",
      locale: "en",
      grade: 1,
      entryDate: daysAgo(2),
    });
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "7",
      locale: "en",
      grade: 2,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);

    const rows = await getCardReviewRows(USER_ID, "7", "en");
    expect(rows).toHaveLength(0);
  });

  // ── Test 5: existing card_reviews row is NOT clobbered ───────────────────
  it("existing card_reviews row is not clobbered; values unchanged after live run", async () => {
    // Pre-existing card_reviews row with reps=5.
    await insertCardReview({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "9",
      locale: "en",
      reps: 5,
    });

    // Matching grade_log entries (graduated subject) that would otherwise be orphans.
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "9",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);

    const rows = await getCardReviewRows(USER_ID, "9", "en");
    // Still exactly one row.
    expect(rows).toHaveLength(1);
    // reps is the original value (5), not what the orphan logic would derive (1).
    expect(rows[0].reps).toBe(5);
  });

  // ── Test 6: locale grouping ───────────────────────────────────────────────
  it("grade_log entries with different locales produce independent orphan rows", async () => {
    // Same subject, two different locales -- both are orphans.
    for (const locale of ["en", "ja"]) {
      await insertGradeLogRow({
        userId: USER_ID,
        cardType: "name",
        subjectKey: "25",
        locale,
        grade: 4,
        entryDate: daysAgo(1),
      });
    }

    await callReconcile(false);

    const enRows = await getCardReviewRows(USER_ID, "25", "en");
    const jaRows = await getCardReviewRows(USER_ID, "25", "ja");
    expect(enRows).toHaveLength(1);
    expect(jaRows).toHaveLength(1);
    expect(enRows[0].locale).toBe("en");
    expect(jaRows[0].locale).toBe("ja");
  });

  // ── Test 7: card-type normalisation (evolution → evolution-edge) ──────────
  it("grade_log card_type='evolution' is normalised to 'evolution-edge' in card_reviews", async () => {
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "evolution",
      subjectKey: "100-101",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);

    // card_reviews should have 'evolution-edge', not 'evolution'.
    const res = await pool.query(
      `SELECT card_type FROM card_reviews
       WHERE user_id = $1 AND subject_key = $2 AND locale = $3`,
      [USER_ID, "100-101", "en"],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].card_type).toBe("evolution-edge");
  });

  // ── Test 9: card-type normalisation (reverse-evolution → reverse-evolution-edge) ──
  it("grade_log card_type='reverse-evolution' is normalised to 'reverse-evolution-edge' in card_reviews", async () => {
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "reverse-evolution",
      subjectKey: "101-102",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);

    // card_reviews should have 'reverse-evolution-edge', not 'reverse-evolution'.
    const res = await pool.query(
      `SELECT card_type FROM card_reviews
       WHERE user_id = $1 AND subject_key = $2 AND locale = $3`,
      [USER_ID, "101-102", "en"],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].card_type).toBe("reverse-evolution-edge");
  });

  // ── Test 8: lapses counter derived correctly ──────────────────────────────
  it("lapses counts Again grades that occurred after the first graduation", async () => {
    // Sequence: Good (graduation) → Again (lapse) → Good.
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "150",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(3),
    });
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "150",
      locale: "en",
      grade: 1,
      entryDate: daysAgo(2),
    });
    await insertGradeLogRow({
      userId: USER_ID,
      cardType: "name",
      subjectKey: "150",
      locale: "en",
      grade: 4,
      entryDate: daysAgo(1),
    });

    await callReconcile(false);

    const rows = await getCardReviewRows(USER_ID, "150", "en");
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(2);   // two grade>=4 entries
    expect(rows[0].lapses).toBe(1); // one Again after first graduation
  });
});
