/**
 * Integration test: card_reviews_reject_regression_trigger.
 *
 * Verifies that the DB-level trigger (migration 002, updated in 015/016/017/020/021/022)
 * blocks lifecycle-timestamp regressions:
 *   - last_review cannot transition to NULL
 *   - first_seen cannot transition to NULL
 *   - last_review cannot move backward
 *
 * Also covers:
 *   - reps / lapses monotonicity guards (migrations 015/016)
 *   - scheduled_days same-date regression guard (migration 016)
 *   - seen_in_pasture one-way flag (migration 017)
 *   - stability / difficulty bounds CHECK constraints (migration 020)
 *   - streak_days no-future-date constraint (migration 021)
 *   - user_settings last_reset_at tombstone triggers (migration 022)
 *
 * All writes use direct SQL via pg, wrapped in transactions that ROLLBACK at
 * the end for isolation. `set_config('request.jwt.claims', ...)` makes `auth.uid()`
 * return the test user's UUID, satisfying RLS policies.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
  withUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import pg from "pg";
import { randomUUID } from "node:crypto";

let pool: pg.Pool;
let dbName: string;
const USER_ID = randomUUID();

/** INSERT a reviewed card row directly via SQL. */
async function insertCard(
  client: pg.PoolClient,
  subjectKey: string,
): Promise<void> {
  await client.query(
    `INSERT INTO card_reviews
       (user_id, card_type, subject_key,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        seen_in_pasture, updated_at)
     VALUES ($1, 'name', $2,
             2.0, 5.0, 1, 3,
             2, 0, 'review',
             '2026-06-01', '2026-05-20', '2026-05-18',
             false, now())`,
    [USER_ID, subjectKey],
  );
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  // Insert the auth.users row so FK on card_reviews is satisfied.
  await insertAuthUser(pool, USER_ID);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("regression trigger (integration)", () => {
  it("blocks UPDATE that sets last_review to NULL", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "101");
        await expect(
          c.query(
            `UPDATE card_reviews
             SET last_review = NULL
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '101'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks UPDATE that sets first_seen to NULL", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "102");
        await expect(
          c.query(
            `UPDATE card_reviews
             SET first_seen = NULL
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '102'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks UPDATE that moves last_review backward", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "103");
        // last_review is 2026-05-20; try to move it to 2026-05-01.
        await expect(
          c.query(
            `UPDATE card_reviews
             SET last_review = '2026-05-01'
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '103'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows UPDATE that moves last_review forward", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "104");
        // last_review is 2026-05-20; move forward to 2026-06-01 - should succeed.
        await expect(
          c.query(
            `UPDATE card_reviews
             SET last_review = '2026-06-01'
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '104'`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  it("allows UPDATE that keeps last_review the same", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "105");
        await expect(
          c.query(
            `UPDATE card_reviews
             SET last_review = '2026-05-20', scheduled_days = 7
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '105'`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  it("blocks UPDATE that decreases reps (migration 015)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "106"); // reps=2
        await expect(
          c.query(
            `UPDATE card_reviews
             SET reps = 1
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '106'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks UPDATE that decreases lapses (migration 015)", async () => {
    // Insert a row with lapses=2 directly (bypassing withUser for the INSERT,
    // which would roll back). The INSERT goes directly through the pool so the
    // row is committed and visible for the subsequent UPDATE test.
    await pool.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', '107',
               2.0, 5.0, 1, 3,
               3, 2, 'review',
               '2026-06-01', '2026-05-20', '2026-05-18',
               false, now())`,
      [USER_ID],
    );
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await expect(
          c.query(
            `UPDATE card_reviews
             SET lapses = 1
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '107'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks UPDATE that drops scheduled_days without advancing last_review (migration 016)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "108"); // scheduled_days=3, last_review='2026-05-20'
        await expect(
          c.query(
            `UPDATE card_reviews
             SET scheduled_days = 1
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '108'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows UPDATE that drops scheduled_days while advancing last_review (Again grade pattern)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "109"); // scheduled_days=3, last_review='2026-05-20'
        // Advancing last_review while dropping scheduled_days is the Again grade pattern.
        await expect(
          c.query(
            `UPDATE card_reviews
             SET last_review = '2026-06-01', scheduled_days = 1
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '109'`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  // ── Migration 017: seen_in_pasture one-way flag ──────────────────────────

  it("blocks UPDATE that clears seen_in_pasture (migration 017)", async () => {
    // Insert a committed row with seen_in_pasture=true so the trigger has an
    // OLD value to compare against.
    await pool.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', '201',
               2.0, 5.0, 1, 3,
               2, 0, 'review',
               '2026-06-01', '2026-05-20', '2026-05-18',
               true, now())`,
      [USER_ID],
    );
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // Attempting to flip seen_in_pasture from true back to false must be
        // rejected - once a user has acknowledged a pasture entry it is permanent.
        await expect(
          c.query(
            `UPDATE card_reviews
             SET seen_in_pasture = false
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '201'`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows UPDATE that sets seen_in_pasture to true (migration 017)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await insertCard(c, "202"); // seen_in_pasture=false
        // Transitioning false → true is the normal pasture-acknowledgement
        // path and must succeed.
        await expect(
          c.query(
            `UPDATE card_reviews
             SET seen_in_pasture = true
             WHERE user_id = $1 AND card_type = 'name' AND subject_key = '202'`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  // ── Migration 020: stability / difficulty bounds ─────────────────────────

  it("blocks INSERT with difficulty above 10 (migration 020)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // difficulty > 10 violates the card_reviews_difficulty_range CHECK.
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '301',
                     2.0, 11.0, 1, 3,
                     2, 0, 'review',
                     '2026-06-01', '2026-05-20', '2026-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks INSERT with difficulty below 0 (migration 020)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // difficulty < 0 violates the card_reviews_difficulty_range CHECK.
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '302',
                     2.0, -1.0, 1, 3,
                     2, 0, 'review',
                     '2026-06-01', '2026-05-20', '2026-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks INSERT with negative stability (migration 020)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // stability < 0 violates the card_reviews_stability_non_negative CHECK.
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '303',
                     -0.1, 5.0, 1, 3,
                     2, 0, 'review',
                     '2026-06-01', '2026-05-20', '2026-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows INSERT with boundary-valid stability and difficulty (migration 020)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // stability=0 is the lower bound; difficulty=10 is the upper bound.
        // Both must be accepted.
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '304',
                     0.0, 10.0, 1, 3,
                     2, 0, 'review',
                     '2026-06-01', '2026-05-20', '2026-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  it("allows INSERT with difficulty = 0 (new-card sentinel, migration 020)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // difficulty=0 is the lower-bound sentinel used for freshly-created
        // cards before any FSRS grade is applied. The CHECK must accept it.
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '305',
                     0.0, 0.0, 1, 3,
                     2, 0, 'review',
                     '2026-06-01', '2026-05-20', '2026-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  // ── Migration 021: streak_days no-future-date constraint ─────────────────

  it("blocks INSERT of a streak_days row far in the future (migration 021)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // Any date more than +1 day ahead of current_date must be rejected.
        // Using a fixed far-future date so the test is not sensitive to clock
        // skew between the DB and the test runner.
        await expect(
          c.query(
            `INSERT INTO streak_days (user_id, review_date)
             VALUES ($1, '2099-12-31')`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows INSERT of a streak_days row for today (migration 021)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // current_date is always within the allowed window.
        await expect(
          c.query(
            `INSERT INTO streak_days (user_id, review_date)
             VALUES ($1, current_date)`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  it("allows INSERT of a streak_days row for tomorrow (+1 grace day for UTC+14 clients, migration 021)", async () => {
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // current_date + 1 is explicitly permitted to accommodate clients whose
        // local clock is a day ahead of the DB's UTC clock (e.g. UTC+14).
        await expect(
          c.query(
            `INSERT INTO streak_days (user_id, review_date)
             VALUES ($1, current_date + 1)`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  // ── Migration 022: user_settings last_reset_at tombstone triggers ─────────

  /** Helper: upsert user_settings with last_reset_at = now() for USER_ID. */
  async function setLastResetAtNow(): Promise<void> {
    await pool.query(
      `INSERT INTO user_settings (user_id, last_reset_at, updated_at)
       VALUES ($1, now(), now())
       ON CONFLICT (user_id) DO UPDATE
         SET last_reset_at = EXCLUDED.last_reset_at,
             updated_at    = EXCLUDED.updated_at`,
      [USER_ID],
    );
  }

  it("blocks INSERT of card_reviews row with first_seen before last_reset_at (migration 022)", async () => {
    // Set last_reset_at = now() so any card whose first_seen is before that
    // date is treated as a resurrection of stale data.
    await setLastResetAtNow();
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        // first_seen in 2020 is clearly before last_reset_at = now().
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '401',
                     2.0, 5.0, 1, 3,
                     2, 0, 'review',
                     '2020-06-01', '2020-05-20', '2020-05-18',
                     false, now())`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks INSERT of a streak_days row with review_date before last_reset_at (migration 022)", async () => {
    // Each migration-022 test sets last_reset_at = now() explicitly so the
    // assertion does not rely on ordering relative to the card_reviews test.
    await setLastResetAtNow();
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await expect(
          c.query(
            `INSERT INTO streak_days (user_id, review_date)
             VALUES ($1, '2020-01-01')`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("blocks INSERT of a grade_log row with entry_date before last_reset_at (migration 022)", async () => {
    await setLastResetAtNow();
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await expect(
          c.query(
            `INSERT INTO grade_log
               (user_id, occurred_at, entry_date, card_type, grade)
             VALUES ($1, extract(epoch from now())::bigint * 1000, '2020-01-01', 'name', 4)`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });

  it("allows INSERT of card_reviews with dates on/after last_reset_at (migration 022)", async () => {
    // Set last_reset_at = now(). Inserting a card with today's dates (on or
    // after the reset boundary) must succeed.
    await setLastResetAtNow();
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '402',
                     2.0, 5.0, 1, 3,
                     2, 0, 'review',
                     current_date + 10, current_date, current_date,
                     false, now())`,
            [USER_ID],
          ),
        ).resolves.toBeDefined();
      });
    } finally {
      client.release();
    }
  });

  // ── Migration 029: locale column + PK expansion (#1259) ─────────────────────

  it("allows two rows differing only by locale (migration 029 PK includes locale)", async () => {
    // After migration 029, the PK is (user_id, card_type, subject_key, locale).
    // The same (user, card_type, subject_key) in "en" and "ja" must coexist as
    // independent rows - this is the key correctness guarantee for per-locale FSRS.
    //
    // Both inserts go through pool.query (not withUser) so the rows are committed
    // and visible to the subsequent SELECT. withUser always rolls back its
    // transaction for test isolation, which would cause the SELECT to return 0 rows.
    //
    // Use now() for first_seen / last_review so the reject_pre_reset_card_reviews
    // trigger does not fire: a prior migration-022 test stamps last_reset_at=now(),
    // and the trigger rejects any first_seen < last_reset_at. current_date resolves
    // to midnight UTC which is earlier than now() whenever the DB clock is past
    // midnight - i.e. always.

    // Insert the "en" row - locale defaults to "en".
    await pool.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', '501',
               2.0, 5.0, 1, 3,
               2, 0, 'review',
               current_date + 10, now()::date, now()::date,
               false, now())`,
      [USER_ID],
    );

    // Insert the "ja" row - same identity except locale.
    await pool.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key, locale,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', '501', 'ja',
               1.5, 5.0, 1, 2,
               1, 0, 'review',
               current_date + 10, now()::date, now()::date,
               false, now())`,
      [USER_ID],
    );

    // Verify both rows exist with independent reps values.
    const { rows } = await pool.query(
      `SELECT locale, reps FROM card_reviews
       WHERE user_id = $1 AND card_type = 'name' AND subject_key = '501'
       ORDER BY locale`,
      [USER_ID],
    );
    expect(rows).toHaveLength(2);
    // "en" row (default)
    expect(rows.find((r: { locale: string }) => r.locale === "en")).toBeDefined();
    // "ja" row (explicitly inserted)
    expect(rows.find((r: { locale: string }) => r.locale === "ja")).toBeDefined();
  });

  it("rejects locale values outside the CHECK constraint (migration 029)", async () => {
    // The locale CHECK constraint only permits 'en', 'ja', 'zh-Hans', 'zh-Hant'.
    const client = await pool.connect();
    try {
      await withUser(client, USER_ID, async (c) => {
        await expect(
          c.query(
            `INSERT INTO card_reviews
               (user_id, card_type, subject_key, locale,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '502', 'fr',
                     2.0, 5.0, 1, 3,
                     2, 0, 'review',
                     current_date + 10, current_date, current_date,
                     false, now())`,
            [USER_ID],
          ),
        ).rejects.toThrow();
      });
    } finally {
      client.release();
    }
  });
});
