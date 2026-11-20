/**
 * The grade_log divergence monitor's SQL (#2096), run against SQLite.
 *
 * `lib/db/system/gradeLogDivergence.ts` runs three queries in the production Worker (the daily
 * `POST /api/cron/grade-log-divergence`, design D13). This file runs the SAME query strings
 * (imported, not copied) against node:sqlite, with the real db/d1/migrations when they exist and
 * otherwise a stand-in holding just the columns the queries read. Ported from the Postgres
 * integration test (lib/sync/integration/grade-log-divergence.test.ts) when the app moved to D1
 * (move-to-cloudflare), and moved here from scripts/ with the queries when the check left GitHub.
 *
 * The bug this pins (#2096): Options A and C treated `MAX(grade) >= 4` as "graduated". A Good on a
 * brand-new card only enters learning step 0 (scheduler case A1), so cards still inside their
 * learning steps, which `isSyncSafe()` deliberately keeps out of card_reviews, were flagged as
 * orphans. The graduation signal is a grade_log row with `learning_step IS NULL` (`learning_step`
 * is the step AFTER the grade, #1416), whatever the grade: a Hard on a graduated card stays
 * graduated (scheduler case A4).
 *
 * Dates are written as `date('now', ...)` in SQL rather than computed in JS, so they share the
 * query's own notion of "today" (UTC) whatever the host timezone.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import {
  OPTION_A_QUERY,
  OPTION_B_QUERY,
  OPTION_C_QUERY,
} from "./gradeLogDivergence";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationsDir = join(repoRoot, "db", "d1", "migrations");

const STAND_IN_SCHEMA = `
CREATE TABLE card_reviews (user_id TEXT NOT NULL, card_type TEXT NOT NULL, subject_key TEXT NOT NULL,
  locale TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL,
  fsrs_state TEXT NOT NULL, due_date TEXT NOT NULL, last_review TEXT, first_seen TEXT,
  seen_in_pasture INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_type, subject_key, locale));
CREATE TABLE grade_log (user_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, entry_date TEXT NOT NULL,
  card_type TEXT NOT NULL, subject_key TEXT NOT NULL, grade INTEGER NOT NULL, locale TEXT NOT NULL,
  learning_step INTEGER, step_started_at INTEGER, UNIQUE (user_id, occurred_at));
`;

const USER_ID = "00000000-0000-4000-8000-0000000d1e01";
const db = new DatabaseSync(":memory:");
if (existsSync(migrationsDir)) {
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  const stamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Divergence test', 'divergence@example.invalid', 0, ?, ?)`,
  ).run(USER_ID, stamp, stamp);
} else {
  db.exec(STAND_IN_SCHEMA);
}

let occurredAtSeq = 1_700_000_000_000;

type Grade = { grade: 1 | 2 | 4 | 5; step: number | null };

/** Insert grade_log rows for one subject, in order, `daysAgo` days back. */
function insertGrades(opts: {
  grades: Grade[];
  daysAgo: number;
  subjectKey?: string;
  cardType?: string;
  locale?: string;
}): void {
  for (const g of opts.grades) {
    occurredAtSeq += 1;
    db.prepare(
      `INSERT INTO grade_log
         (user_id, occurred_at, entry_date, card_type, subject_key, locale, grade, learning_step)
       VALUES (?, ?, date('now', '-' || ? || ' days'), ?, ?, ?, ?, ?)`,
    ).run(
      USER_ID,
      occurredAtSeq,
      opts.daysAgo,
      opts.cardType ?? "name",
      opts.subjectKey ?? "25",
      opts.locale ?? "en",
      g.grade,
      g.step,
    );
  }
}

/** Insert a card_reviews row. `stuck` gives the Option B stuck shape. */
function insertCardReview(opts: {
  subjectKey?: string;
  cardType?: string;
  locale?: string;
  stuck?: boolean;
}): void {
  const stuck = opts.stuck ?? false;
  db.prepare(
    `INSERT INTO card_reviews
       (user_id, card_type, subject_key, locale,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        seen_in_pasture, updated_at)
     VALUES (?, ?, ?, ?,
             2.0, 5.0, 1, 7,
             ?, 0, 'review',
             date('now', '+7 days'), ?, date('now', '-3 days'),
             0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  ).run(
    USER_ID,
    opts.cardType ?? "name",
    opts.subjectKey ?? "25",
    opts.locale ?? "en",
    stuck ? 0 : 2,
    stuck ? null : new Date().toISOString().slice(0, 10),
  );
}

/** Run a monitor query and return the flagged count for the test user. */
function flagged(query: string, column: string): number {
  const rows = db.prepare(query).all() as Record<string, unknown>[];
  const row = rows.find((r) => r.user_id === USER_ID);
  return row ? Number(row[column]) : 0;
}

const optionA = () => flagged(OPTION_A_QUERY, "missing_subjects");
const optionB = () => flagged(OPTION_B_QUERY, "stuck_subjects");
const optionC = () => flagged(OPTION_C_QUERY, "graduated_orphan_subjects");

beforeEach(() => {
  db.prepare(`DELETE FROM card_reviews WHERE user_id = ?`).run(USER_ID);
  db.prepare(`DELETE FROM grade_log WHERE user_id = ?`).run(USER_ID);
});

describe("grade_log divergence monitor: Option C (graduated orphan, no grace)", () => {
  it("does NOT flag a new card graded Good once (4@0, still in learning step 0)", () => {
    insertGrades({ grades: [{ grade: 4, step: 0 }], daysAgo: 0 });
    expect(optionC()).toBe(0);
  });

  it("does NOT flag a new card graded Good twice (4@0, 4@1, still in step 1)", () => {
    insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
      ],
      daysAgo: 0,
    });
    expect(optionC()).toBe(0);
  });

  it("does NOT flag a card the user keeps failing (1@0, 2@0)", () => {
    insertGrades({
      grades: [
        { grade: 1, step: 0 },
        { grade: 2, step: 0 },
      ],
      daysAgo: 0,
    });
    expect(optionC()).toBe(0);
  });

  it("flags a graduated grade (4@null) with no card_reviews row", () => {
    insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
        { grade: 4, step: null },
      ],
      daysAgo: 0,
    });
    expect(optionC()).toBe(1);
  });

  it("flags Easy on a new card (5@null graduates immediately) with no card_reviews row", () => {
    insertGrades({ grades: [{ grade: 5, step: null }], daysAgo: 0 });
    expect(optionC()).toBe(1);
  });

  it("does NOT flag a graduated grade when the card_reviews row exists", () => {
    insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0 });
    insertCardReview({});
    expect(optionC()).toBe(0);
  });

  it("flags a graduated-then-lapsed subject (4@null then 1@0) with no card_reviews row", () => {
    // lastReview stays set through relearning, so isSyncSafe() is true and
    // the row should exist: the latest row being in-step must not hide it.
    insertGrades({
      grades: [
        { grade: 4, step: null },
        { grade: 1, step: 0 },
      ],
      daysAgo: 0,
    });
    expect(optionC()).toBe(1);
  });

  it("flags a graduated card reviewed Hard (2@null, case A4) with no card_reviews row", () => {
    // A Hard on a graduated card keeps it graduated, so the NULL step is a real
    // graduation signal whatever the grade. A `grade >= 4` filter would hide it.
    insertGrades({ grades: [{ grade: 2, step: null }], daysAgo: 0 });
    expect(optionC()).toBe(1);
  });

  it("joins on locale: a row in another locale does not mask the orphan", () => {
    insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0, locale: "ja" });
    insertCardReview({ locale: "en" });
    expect(optionC()).toBe(1);
  });

  it("flags a graduated evolution card with no card_reviews row", () => {
    insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "evolution",
      subjectKey: "1>>>2",
    });
    expect(optionC()).toBe(1);
  });

  it("normalises reverse-evolution card_type to the card_reviews vocabulary (#970)", () => {
    insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "reverse-evolution",
      subjectKey: "1>>>2",
    });
    insertCardReview({ cardType: "reverse-evolution-edge", subjectKey: "1>>>2" });
    expect(optionC()).toBe(0);
  });

  it("flags a graduated reverse-evolution card with no card_reviews row", () => {
    insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "reverse-evolution",
      subjectKey: "1>>>2",
    });
    expect(optionC()).toBe(1);
  });

  it("normalises evolution card_type to the card_reviews vocabulary (#970)", () => {
    insertGrades({
      grades: [{ grade: 4, step: null }],
      daysAgo: 0,
      cardType: "evolution",
      subjectKey: "1>>>2",
    });
    insertCardReview({ cardType: "evolution-edge", subjectKey: "1>>>2" });
    expect(optionC()).toBe(0);
  });
});

describe("grade_log divergence monitor: Option A (row never written, 2-day grace)", () => {
  it("does NOT flag an abandoned new card graded Good once 3 days ago (4@0)", () => {
    insertGrades({ grades: [{ grade: 4, step: 0 }], daysAgo: 3 });
    expect(optionA()).toBe(0);
  });

  it("does NOT flag an abandoned card graded 4@0, 4@1 3 days ago", () => {
    insertGrades({
      grades: [
        { grade: 4, step: 0 },
        { grade: 4, step: 1 },
      ],
      daysAgo: 3,
    });
    expect(optionA()).toBe(0);
  });

  it("flags a card that graduated 3 days ago (4@null) with no card_reviews row", () => {
    insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 3 });
    expect(optionA()).toBe(1);
  });

  it("flags a graduated card reviewed Hard 3 days ago (2@null, case A4) with no card_reviews row", () => {
    insertGrades({ grades: [{ grade: 2, step: null }], daysAgo: 3 });
    expect(optionA()).toBe(1);
  });

  it("does NOT flag a graduated card inside the 2-day grace (Option C's job)", () => {
    insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 0 });
    expect(optionA()).toBe(0);
  });

  it("joins on locale: a row in another locale does not mask the orphan", () => {
    insertGrades({ grades: [{ grade: 4, step: null }], daysAgo: 3, locale: "zh-Hans" });
    insertCardReview({ locale: "en" });
    expect(optionA()).toBe(1);
  });
});

describe("grade_log divergence monitor: Option B (row stuck stale)", () => {
  const threeGrades: Grade[] = [
    { grade: 4, step: 0 },
    { grade: 4, step: 1 },
    { grade: 4, step: null },
  ];

  it("flags a stuck row in the same locale as >=3 grades", () => {
    insertGrades({ grades: threeGrades, daysAgo: 3 });
    insertCardReview({ stuck: true });
    expect(optionB()).toBe(1);
  });

  it("does NOT pair grades in one locale with a stuck row in another", () => {
    insertGrades({ grades: threeGrades, daysAgo: 3, locale: "ja" });
    insertCardReview({ stuck: true, locale: "en" });
    expect(optionB()).toBe(0);
  });
});
