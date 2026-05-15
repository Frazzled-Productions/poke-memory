/**
 * Integration test: card_reviews_reject_regression_trigger.
 *
 * Verifies that the DB-level trigger (migration 002, updated in 015/016/017)
 * blocks lifecycle-timestamp regressions:
 *   - last_review cannot transition to NULL
 *   - first_seen cannot transition to NULL
 *   - last_review cannot move backward
 *
 * Also covers the reps / lapses monotonicity guards from migrations 015/016
 * and the scheduled_days same-date regression guard from migration 016.
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
        // last_review is 2026-05-20; move forward to 2026-06-01 — should succeed.
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
});
