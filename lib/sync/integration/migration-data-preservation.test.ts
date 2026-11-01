/**
 * Integration test: migrations keep the rows they should keep (#2217).
 *
 * `apply-migrations.test.ts` proves every file applies to an empty schema, so a
 * data-rewriting migration runs on empty tables there. Each test here applies
 * migrations up to a cut-off, seeds rows in that era's schema, applies the rest
 * and asserts counts and values on the schema at the head of db/migrations/.
 *
 * Two kinds of test:
 *
 *   - Named rewrites (004, 009, 010, 012, 013): pins what each one did to rows.
 *     These files are already applied, so the value is an exact record of the
 *     outcome and a template for the next rewrite.
 *
 *   - The sweep: rows in every table at SWEEP_BASELINE go through every later
 *     migration unchanged. This is the guard for FUTURE migrations; a new file in
 *     db/migrations/ is covered with no edit here.
 *
 * If the sweep fails on your migration, you are losing or rewriting rows. When
 * that is what you meant, add a named test for the rewrite and move SWEEP_BASELINE
 * to your migration, updating SWEEP_SEED only if the schema needs it. #2158 is the
 * separate check on what a migration's SQL is allowed to say.
 */

import { describe, it, expect } from "vitest";
import pg from "pg";
import {
  applyPreMigrationFixture,
  createTestDatabase,
  dropTestDatabase,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";

const USER = "00000000-0000-4000-8000-000000000001";
const TIMEOUT_MS = 30_000;

/** The last migration to add a table, so SWEEP_SEED fills all of them. */
const SWEEP_BASELINE = "041_rate_limit_buckets.sql";

/** One INSERT per public table, valid at SWEEP_BASELINE and never run later. */
const SWEEP_SEED: Record<string, string> = {
  card_reviews: `
    INSERT INTO card_reviews (
      user_id, card_type, subject_key, locale, due_date, last_review, first_seen,
      stability, difficulty, elapsed_days, scheduled_days, reps, lapses, fsrs_state,
      hidden_since, seen_in_pasture
    ) VALUES
      ('${USER}', 'name', '25', 'en', '2026-02-01', '2026-01-20', '2025-12-01',
       12.5, 4.25, 3, 12, 7, 1, 'review', NULL, true),
      ('${USER}', 'evolution-edge', '1>>>2', 'ja', '2026-02-02', NULL, NULL,
       0, 0, 0, 0, 0, 0, 'new', '2026-01-15', false)`,
  grade_log: `
    INSERT INTO grade_log (
      user_id, occurred_at, entry_date, card_type, subject_key, grade, locale,
      learning_step, step_started_at
    ) VALUES
      ('${USER}', 1767225600000, '2026-01-01', 'name', '25', 4, 'en', NULL, NULL),
      ('${USER}', 1767225600001, '2026-01-01', 'evolution', '1>>>2', 1, 'ja', 0, 1767225500000)`,
  streak_days: `INSERT INTO streak_days (user_id, review_date) VALUES ('${USER}', '2026-01-01')`,
  user_settings: `
    INSERT INTO user_settings (
      user_id, settings, timezone, date_format, push_notification_hour, last_reset_at
    ) VALUES (
      '${USER}', '{"theme":"dark","limits":{"name":20}}', 'Europe/London', 'dmy', 8, NULL
    )`,
  push_subscriptions: `
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret)
    VALUES ('${USER}', 'https://push.example.test/1', 'p256dh-value', 'auth-value')`,
  feedback: `
    INSERT INTO feedback (user_id, category, message, page, app_version) VALUES
      ('${USER}', 'bug', 'signed-in report', '/stats', '0.11.15'),
      (NULL, 'other', 'guest report', NULL, NULL)`,
  usernames: `INSERT INTO usernames (username, user_id) VALUES ('ash_ketchum', '${USER}')`,
  rate_limit_buckets: `
    INSERT INTO rate_limit_buckets (ip_hash, action) VALUES ('${"a".repeat(64)}', 'signin')`,
};

/** A fresh database migrated through `through`, with one auth.users row. */
async function withDatabase(
  through: string,
  run: (pool: pg.Pool) => Promise<void>,
): Promise<void> {
  const { pool, dbName } = await createTestDatabase();
  try {
    await applyPreMigrationFixture(pool);
    await insertAuthUser(pool, USER);
    await applyMigrations(pool, { through });
    await run(pool);
  } finally {
    await dropTestDatabase(pool, dbName);
  }
}

type Row = Record<string, unknown>;

async function readTable(pool: pg.Pool, table: string): Promise<Row[]> {
  const { rows } = await pool.query<{ row: Row }>(
    `SELECT to_jsonb(t) AS row FROM public.${table} t`,
  );
  return rows.map((r) => r.row);
}

/** Rows as sorted JSON, limited to `columns`, so added columns do not count as a change. */
function comparable(rows: Row[], columns: string[]): string[] {
  return rows
    .map((row) => JSON.stringify(columns.map((c) => [c, row[c]])))
    .sort();
}

describe("migration data preservation (integration)", () => {
  it(
    "004, 009, 010, 012: SM-2 card_reviews rows reach the head schema with FSRS state and string keys",
    async () => {
      await withDatabase("003_user_settings_jsonb_column.sql", async (pool) => {
        await pool.query(
          `INSERT INTO card_reviews (
             user_id, pokemon_id, repetitions, interval, ease_factor, due_date,
             last_review, first_seen
           ) VALUES
             ($1,       1, 3, 12, 2.5, '2026-02-01', '2026-01-20', '2025-12-01'),
             ($1,      25, 0,  0, 2.5, '2026-02-02', NULL,         NULL),
             ($1, 1000000, 1,  1, 1.3, '2026-02-03', '2026-01-21', '2025-12-02'),
             ($1, 1000001, 2,  6, 2.5, '2026-02-04', '2026-01-22', '2025-12-03'),
             ($1, 1500000, 2,  6, 2.5, '2026-02-05', '2026-01-23', '2025-12-04'),
             ($1, 2000025, 2,  6, 1.9, '2026-02-06', '2026-01-24', '2025-12-05'),
             ($1, 3000150, 1,  0, 2.5, '2026-02-07', '2026-01-25', '2025-12-06')`,
          [USER],
        );

        await applyMigrations(pool, { after: "003_user_settings_jsonb_column.sql" });

        const { rows } = await pool.query(
          `SELECT card_type, subject_key, locale, due_date::text, last_review::text,
                  first_seen::text, stability::float8, difficulty::float8, elapsed_days,
                  scheduled_days, reps, lapses, fsrs_state, seen_in_pasture
             FROM card_reviews
            WHERE user_id = $1
            ORDER BY due_date`,
          [USER],
        );

        const base = { locale: "en", elapsed_days: 0, lapses: 0, seen_in_pasture: false };
        // 1000001 and 1500000 are the ends of the legacy range 009 deletes.
        expect(rows).toEqual([
          {
            ...base, card_type: "name", subject_key: "1",
            due_date: "2026-02-01", last_review: "2026-01-20", first_seen: "2025-12-01",
            stability: 12, difficulty: 1, scheduled_days: 12, reps: 3, fsrs_state: "review",
          },
          {
            ...base, card_type: "name", subject_key: "25",
            due_date: "2026-02-02", last_review: null, first_seen: null,
            stability: 0, difficulty: 0, scheduled_days: 0, reps: 0, fsrs_state: "new",
          },
          {
            ...base, card_type: "name", subject_key: "1000000",
            due_date: "2026-02-03", last_review: "2026-01-21", first_seen: "2025-12-02",
            stability: 1, difficulty: 10, scheduled_days: 1, reps: 1, fsrs_state: "review",
          },
          {
            ...base, card_type: "reverse", subject_key: "25",
            due_date: "2026-02-06", last_review: "2026-01-24", first_seen: "2025-12-05",
            stability: 6, difficulty: 5.5, scheduled_days: 6, reps: 2, fsrs_state: "review",
          },
          {
            ...base, card_type: "cry", subject_key: "150",
            due_date: "2026-02-07", last_review: "2026-01-25", first_seen: "2025-12-06",
            stability: 1, difficulty: 1, scheduled_days: 0, reps: 1, fsrs_state: "review",
          },
        ]);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "005: user_settings and streak_days rows survive every later migration",
    async () => {
      await withDatabase("003_user_settings_jsonb_column.sql", async (pool) => {
        const settings = { theme: "dark", limits: { name: 20 } };
        await pool.query(
          `INSERT INTO user_settings (user_id, max_new_per_day, settings, updated_at)
           VALUES ($1, 20, $2, '2026-01-01T00:00:00Z')`,
          [USER, JSON.stringify(settings)],
        );
        await pool.query(
          `INSERT INTO streak_days (user_id, review_date) VALUES ($1, '2026-01-01')`,
          [USER],
        );

        await applyMigrations(pool, { after: "003_user_settings_jsonb_column.sql" });

        const userSettings = await pool.query(
          `SELECT settings, updated_at, timezone, last_reset_at FROM user_settings`,
        );
        expect(userSettings.rows).toEqual([
          {
            settings,
            updated_at: new Date("2026-01-01T00:00:00Z"),
            timezone: null,
            last_reset_at: null,
          },
        ]);

        const streaks = await pool.query(`SELECT review_date::text FROM streak_days`);
        expect(streaks.rows).toEqual([{ review_date: "2026-01-01" }]);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "013: grade_log keeps the rows it can rekey and drops only the three unbackfillable groups",
    async () => {
      await withDatabase("012_card_reviews_finalise.sql", async (pool) => {
        await pool.query(
          `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, card_id)
           VALUES
             ($1,  1, '2026-01-01', 'name',              4,       25),
             ($1,  2, '2026-01-02', 'name',              5,   999999),
             ($1,  3, '2026-01-03', 'reverse',           2,  2000025),
             ($1,  4, '2026-01-04', 'reverse',           1,  2499999),
             ($1,  5, '2026-01-05', 'cry',               4,  3000150),
             ($1,  6, '2026-01-06', 'evolution',         4,  1500000),
             ($1,  7, '2026-01-07', 'evolution',         4,  1999999),
             ($1,  8, '2026-01-08', 'reverse-evolution', 4,  2500000),
             ($1,  9, '2026-01-09', 'reverse-evolution', 4,  2999999),
             ($1, 10, '2026-01-10', 'name',              4,     NULL)`,
          [USER],
        );

        await applyMigrations(pool, { after: "012_card_reviews_finalise.sql" });

        const { rows } = await pool.query(
          `SELECT occurred_at::int, entry_date::text, card_type, subject_key, grade, locale
             FROM grade_log
            WHERE user_id = $1
            ORDER BY occurred_at`,
          [USER],
        );
        expect(rows).toEqual([
          { occurred_at: 1, entry_date: "2026-01-01", card_type: "name", subject_key: "25", grade: 4, locale: "en" },
          { occurred_at: 2, entry_date: "2026-01-02", card_type: "name", subject_key: "999999", grade: 5, locale: "en" },
          { occurred_at: 3, entry_date: "2026-01-03", card_type: "reverse", subject_key: "25", grade: 2, locale: "en" },
          { occurred_at: 4, entry_date: "2026-01-04", card_type: "reverse", subject_key: "499999", grade: 1, locale: "en" },
          { occurred_at: 5, entry_date: "2026-01-05", card_type: "cry", subject_key: "150", grade: 4, locale: "en" },
        ]);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "012: an evolution row that 010 left unkeyed stops the migration and keeps its data",
    async () => {
      const before010 = "009_grade_log_card_id_and_card_types.sql";
      const before012 = "011_merge_user_settings.sql";

      await withDatabase(before010, async (pool) => {
        await pool.query(
          `INSERT INTO card_reviews (user_id, pokemon_id, due_date, reps, last_review)
           VALUES ($1, 1500001, '2026-02-01', 4, '2026-01-20')`,
          [USER],
        );

        await applyMigrations(pool, { after: before010, through: before012 });
        await expect(applyMigrations(pool, { after: before012 })).rejects.toThrow(
          /012_card_reviews_finalise.*"card_type".*null values/,
        );

        // Each file is one transaction, so 012 undid its own subject_key backfill.
        const { rows } = await pool.query(
          `SELECT pokemon_id, card_type, subject_key, reps, last_review::text FROM card_reviews`,
        );
        expect(rows).toEqual([
          { pokemon_id: 1500001, card_type: null, subject_key: null, reps: 4, last_review: "2026-01-20" },
        ]);
      });
    },
    TIMEOUT_MS,
  );

  it(
    "sweep: rows in every table pass through every migration after the baseline unchanged",
    async () => {
      await withDatabase(SWEEP_BASELINE, async (pool) => {
        const { rows: tables } = await pool.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        );
        expect(
          tables.map((t) => t.tablename),
          "every public table at the baseline needs a row in SWEEP_SEED",
        ).toEqual(Object.keys(SWEEP_SEED).sort());

        const before: Record<string, Row[]> = {};
        for (const [table, insert] of Object.entries(SWEEP_SEED)) {
          await pool.query(insert);
          before[table] = await readTable(pool, table);
          expect(before[table].length, `${table} seed`).toBeGreaterThan(0);
        }

        await applyMigrations(pool, { after: SWEEP_BASELINE });

        for (const [table, rows] of Object.entries(before)) {
          const columns = Object.keys(rows[0]);
          expect(
            comparable(await readTable(pool, table), columns),
            `${table} after the migrations following ${SWEEP_BASELINE}`,
          ).toEqual(comparable(rows, columns));
        }
      });
    },
    TIMEOUT_MS,
  );
});
