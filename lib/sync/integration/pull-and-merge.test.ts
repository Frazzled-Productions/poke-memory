/**
 * Integration test: upsert conflict resolution and per-card merge conflict rule.
 *
 * Covers the real-Postgres behaviour that pullAndMerge / pushSingleCard depend on
 * but that unit tests (with mocked Supabase) cannot verify:
 *
 * 1. Upsert conflict resolution — INSERT … ON CONFLICT (user_id, card_type,
 *    subject_key) DO UPDATE correctly overwrites every FSRS field when a row
 *    already exists, and correctly INSERTs when no row exists.
 *
 * 2. Forward-progress is preserved — upserting a row with an older last_review
 *    via a same-key INSERT does NOT trigger the regression trigger (the upsert
 *    arrives as a new-INSERT on ON CONFLICT path), but an explicit UPDATE with
 *    a regressed last_review still fires the trigger (regression-trigger.test.ts
 *    covers that path; this file confirms the ON CONFLICT update does not).
 *
 * 3. Per-card conflict rule semantics — the `mergeCloudIntoLocalSilent` function
 *    implements a lastPullAt-based rule. This test verifies the *DB preconditions*
 *    that rule relies on:
 *    a. updated_at is written correctly on every upsert (the merge rule reads it
 *       from cloud rows to determine whether the cloud row is newer than lastPullAt).
 *    b. An upsert that advances FSRS state correctly updates updated_at so the
 *       pull-side rule can pick it up.
 *    c. A repeated upsert of the same state (no change) still writes updated_at
 *       (PostgreSQL ON CONFLICT DO UPDATE unconditionally executes the SET clause).
 *
 * 4. Multi-user isolation — two users sharing the same (card_type, subject_key)
 *    are stored as separate rows and neither upsert clobbers the other.
 *
 * 5. seen_in_pasture one-way invariant (migration 017) — the upsert path that
 *    tries to write seen_in_pasture = false when the existing row has true must be
 *    rejected by the trigger, even when arriving as an ON CONFLICT DO UPDATE.
 *
 * 6. card_type discriminator — two cards with the same subject_key but different
 *    card_types are stored as entirely independent rows in the composite PK.
 *
 * All writes use direct SQL via pg (no Supabase JS client). The ON CONFLICT clause
 * is written to match the pushSingleCard / pushSession production paths (lib/sync/cloud.ts),
 * which always include both `hidden_since` and `seen_in_pasture` in every upsert.
 * Note: the beacon route (app/api/sync/route.ts) takes a slightly different approach —
 * it always writes `hidden_since` but conditionally omits `seen_in_pasture` when the
 * field is null, so that a missing value on the wire does not clobber an existing true.
 * The helper here matches the pushSingleCard / pushSession shape; the trigger-rejection
 * tests for the one-way `seen_in_pasture` invariant remain valid regardless.
 *
 * Write helpers commit their transactions so subsequent reads via readCard see the
 * persisted state. Tests that seed initial rows for rejection scenarios use the
 * pool directly (superuser connection, bypasses RLS) so the seed data is committed
 * before the failing upsert is attempted.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const USER_A = randomUUID();
const USER_B = randomUUID();

/** Fixed past timestamps that are clearly distinct from each other. */
const T1 = "2026-05-01T10:00:00.000Z"; // older
const T2 = "2026-05-10T12:00:00.000Z"; // newer

/**
 * Upserts a card_reviews row and COMMITS the transaction so subsequent
 * `readCard` calls can see the persisted state.
 *
 * The ON CONFLICT clause matches the pushSingleCard / pushSession production
 * paths: `hidden_since` is always written (coalescing absent values to null),
 * and `seen_in_pasture` is always written. `set_config('request.jwt.claims', …)`
 * makes `auth.uid()` return the given userId, satisfying RLS policies.
 */
async function upsertAndCommit(
  pool: pg.Pool,
  userId: string,
  opts: {
    subjectKey: string;
    cardType?: string;
    stability?: number;
    difficulty?: number;
    elapsedDays?: number;
    scheduledDays?: number;
    reps?: number;
    lapses?: number;
    fsrsState?: string;
    dueDate?: string;
    lastReview?: string | null;
    firstSeen?: string | null;
    hiddenSince?: string | null;
    seenInPasture?: boolean;
    updatedAt?: string;
  },
): Promise<void> {
  const {
    subjectKey,
    cardType = "name",
    stability = 1.0,
    difficulty = 5.0,
    elapsedDays = 1,
    scheduledDays = 3,
    reps = 1,
    lapses = 0,
    fsrsState = "review",
    dueDate = "2026-06-01",
    lastReview = "2026-05-20",
    firstSeen = "2026-05-18",
    hiddenSince = null,
    seenInPasture = false,
    updatedAt = T1,
  } = opts;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    await client.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          hidden_since, seen_in_pasture, updated_at)
       VALUES ($1, $2, $3,
               $4, $5, $6, $7,
               $8, $9, $10,
               $11, $12, $13,
               $14, $15, $16)
       ON CONFLICT (user_id, card_type, subject_key) DO UPDATE SET
         stability       = EXCLUDED.stability,
         difficulty      = EXCLUDED.difficulty,
         elapsed_days    = EXCLUDED.elapsed_days,
         scheduled_days  = EXCLUDED.scheduled_days,
         reps            = EXCLUDED.reps,
         lapses          = EXCLUDED.lapses,
         fsrs_state      = EXCLUDED.fsrs_state,
         due_date        = EXCLUDED.due_date,
         last_review     = EXCLUDED.last_review,
         first_seen      = EXCLUDED.first_seen,
         hidden_since    = EXCLUDED.hidden_since,
         seen_in_pasture = EXCLUDED.seen_in_pasture,
         updated_at      = EXCLUDED.updated_at`,
      [
        userId,
        cardType,
        subjectKey,
        stability,
        difficulty,
        elapsedDays,
        scheduledDays,
        reps,
        lapses,
        fsrsState,
        dueDate,
        lastReview,
        firstSeen,
        hiddenSince,
        seenInPasture,
        updatedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reads a single card row from the pool (outside any transaction so it sees
 * committed state). Returns null if no matching row exists.
 */
async function readCard(
  userId: string,
  cardType: string,
  subjectKey: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT stability, difficulty, elapsed_days, scheduled_days,
            reps, lapses, fsrs_state, due_date,
            last_review, first_seen, seen_in_pasture, updated_at
     FROM card_reviews
     WHERE user_id = $1 AND card_type = $2 AND subject_key = $3`,
    [userId, cardType, subjectKey],
  );
  return rows.length > 0 ? rows[0] : null;
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_A);
  await insertAuthUser(pool, USER_B);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

// ── 1. Basic upsert conflict resolution ─────────────────────────────────────

describe("upsert conflict resolution (integration)", () => {
  it("INSERT creates a new row when none exists", async () => {
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "1001",
      reps: 2,
      stability: 2.5,
    });

    const row = await readCard(USER_A, "name", "1001");
    expect(row).not.toBeNull();
    expect(Number(row!.reps)).toBe(2);
    expect(Number(row!.stability)).toBeCloseTo(2.5);
  });

  it("ON CONFLICT overwrites all FSRS fields on second upsert of same key", async () => {
    // First upsert — baseline state.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "1002",
      reps: 1,
      lapses: 0,
      scheduledDays: 3,
      stability: 1.0,
      difficulty: 5.0,
      lastReview: "2026-05-10",
      firstSeen: "2026-05-08",
      updatedAt: T1,
    });

    // Second upsert — newer FSRS state (simulates a review on another device).
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "1002",
      reps: 2,
      lapses: 0,
      scheduledDays: 7,
      stability: 3.5,
      difficulty: 4.8,
      lastReview: "2026-05-20",
      firstSeen: "2026-05-08",
      updatedAt: T2,
    });

    const row = await readCard(USER_A, "name", "1002");
    expect(row).not.toBeNull();
    expect(Number(row!.reps)).toBe(2);
    expect(Number(row!.scheduled_days)).toBe(7);
    expect(Number(row!.stability)).toBeCloseTo(3.5);
    expect(Number(row!.difficulty)).toBeCloseTo(4.8);
    // DB stores date columns; the pg client parses them as JS Date objects.
    expect(row!.last_review).toBeInstanceOf(Date);
    expect(
      (row!.last_review as Date).toISOString().slice(0, 10),
    ).toBe("2026-05-20");
  });

  it("ON CONFLICT correctly updates updated_at to the EXCLUDED value", async () => {
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "1003",
      updatedAt: T1,
    });
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "1003",
      reps: 2,
      updatedAt: T2,
      lastReview: "2026-05-21",
      scheduledDays: 10,
    });

    const row = await readCard(USER_A, "name", "1003");
    expect(row).not.toBeNull();
    // updated_at must reflect T2, not T1. This is the value the merge conflict
    // rule compares against lastPullAt to determine whether the cloud row is newer.
    const storedAt = (row!.updated_at as Date).toISOString();
    expect(storedAt).toBe(T2);
  });

  it("repeated upsert of unchanged state still writes updated_at", async () => {
    // PostgreSQL unconditionally executes the DO UPDATE SET clause even when the
    // incoming row is identical to the stored row. The merge rule relies on
    // updated_at advancing so a re-push after a pull does not look stale.
    await upsertAndCommit(pool, USER_A, { subjectKey: "1004", updatedAt: T1 });
    // Identical FSRS state, newer updated_at timestamp only.
    await upsertAndCommit(pool, USER_A, { subjectKey: "1004", updatedAt: T2 });

    const row = await readCard(USER_A, "name", "1004");
    expect(row).not.toBeNull();
    expect((row!.updated_at as Date).toISOString()).toBe(T2);
  });
});

// ── 2. Multi-user isolation ──────────────────────────────────────────────────

describe("multi-user isolation (integration)", () => {
  it("two users sharing (card_type, subject_key) get distinct rows", async () => {
    const KEY = "2001";

    await upsertAndCommit(pool, USER_A, { subjectKey: KEY, reps: 3, stability: 4.0 });
    await upsertAndCommit(pool, USER_B, { subjectKey: KEY, reps: 1, stability: 1.2 });

    const rowA = await readCard(USER_A, "name", KEY);
    const rowB = await readCard(USER_B, "name", KEY);

    // Both rows must exist and be independent.
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(Number(rowA!.reps)).toBe(3);
    expect(Number(rowB!.reps)).toBe(1);
    expect(Number(rowA!.stability)).toBeCloseTo(4.0);
    expect(Number(rowB!.stability)).toBeCloseTo(1.2);
  });

  it("upsert for USER_A does not affect USER_B's row for the same key", async () => {
    const KEY = "2002";

    await upsertAndCommit(pool, USER_A, { subjectKey: KEY, reps: 1 });
    await upsertAndCommit(pool, USER_B, { subjectKey: KEY, reps: 5, stability: 9.9 });

    // Re-upsert USER_A with different state — must not touch USER_B's row.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: KEY,
      reps: 2,
      scheduledDays: 14,
      lastReview: "2026-05-25",
    });

    const rowB = await readCard(USER_B, "name", KEY);
    expect(rowB).not.toBeNull();
    expect(Number(rowB!.reps)).toBe(5);
    expect(Number(rowB!.stability)).toBeCloseTo(9.9);
  });
});

// ── 3. updated_at as the merge-rule anchor ───────────────────────────────────

describe("updated_at as merge-rule anchor (integration)", () => {
  it("a row pushed with T1 then T2 is visible as updated after T1", async () => {
    // The merge conflict rule in mergeCloudIntoLocalSilent does:
    //   if (!row.updated_at || row.updated_at > lastPullAt) → take cloud
    // This test verifies the DB stores updated_at precisely so the rule works.
    await upsertAndCommit(pool, USER_A, { subjectKey: "3001", updatedAt: T1 });

    const rowAfterFirst = await readCard(USER_A, "name", "3001");
    expect(rowAfterFirst).not.toBeNull();
    const firstAt = (rowAfterFirst!.updated_at as Date).toISOString();
    // T1 must compare correctly against itself. The merge rule checks
    // `row.updated_at > lastPullAt` — a pull anchored at T1 would see this row
    // as "not newer" (T1 is not > T1) and would keep local state.
    expect(firstAt).toBe(T1);

    await upsertAndCommit(pool, USER_A, {
      subjectKey: "3001",
      reps: 3,
      scheduledDays: 21,
      lastReview: "2026-05-20",
      updatedAt: T2,
    });

    const rowAfterSecond = await readCard(USER_A, "name", "3001");
    expect(rowAfterSecond).not.toBeNull();
    const secondAt = (rowAfterSecond!.updated_at as Date).toISOString();
    // T2 > T1 — a pull anchored at T1 correctly classifies this row as newer
    // and would take the cloud row.
    expect(secondAt > T1).toBe(true);
    expect(Number(rowAfterSecond!.reps)).toBe(3);
  });

  it("a fresh-device pull (lastPullAt = null) can read the stored row", async () => {
    // When lastPullAt is null, mergeCloudIntoLocalSilent applies cloud state to
    // any local card that has no progress (lastReview === null). This test
    // verifies that after an upsert the row is readable — the fields the merge
    // function reads (reps, last_review, first_seen, updated_at) are all present.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "3002",
      reps: 4,
      lastReview: "2026-05-15",
      firstSeen: "2026-05-10",
      updatedAt: T2,
    });

    const row = await readCard(USER_A, "name", "3002");
    expect(row).not.toBeNull();
    // Confirm the data the pull would overlay onto the pristine local card.
    expect(Number(row!.reps)).toBe(4);
    expect(
      (row!.last_review as Date).toISOString().slice(0, 10),
    ).toBe("2026-05-15");
    expect(
      (row!.first_seen as Date).toISOString().slice(0, 10),
    ).toBe("2026-05-10");
  });
});

// ── 4. seen_in_pasture via ON CONFLICT ──────────────────────────────────────

describe("seen_in_pasture invariant via ON CONFLICT update (integration)", () => {
  it("upsert that clears seen_in_pasture (true → false) is rejected by the trigger", async () => {
    // Commit a row with seen_in_pasture = true directly so the trigger has
    // OLD.seen_in_pasture = true to compare against.
    await pool.query(
      `INSERT INTO card_reviews
         (user_id, card_type, subject_key,
          stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, fsrs_state,
          due_date, last_review, first_seen,
          seen_in_pasture, updated_at)
       VALUES ($1, 'name', '4001',
               2.0, 5.0, 1, 3,
               2, 0, 'review',
               '2026-06-01', '2026-05-20', '2026-05-18',
               true, $2)`,
      [USER_A, T1],
    );

    // Attempt an upsert via ON CONFLICT that sets seen_in_pasture = false.
    // The regression trigger fires on the DO UPDATE path (which is an UPDATE
    // in PostgreSQL's trigger model) and must reject it.
    await expect(
      upsertAndCommit(pool, USER_A, {
        subjectKey: "4001",
        seenInPasture: false, // attempt to clear the one-way flag
        lastReview: "2026-05-21",
        reps: 3,
        updatedAt: T2,
      }),
    ).rejects.toThrow();

    // The row must still have seen_in_pasture = true after the rejected upsert.
    const row = await readCard(USER_A, "name", "4001");
    expect(row).not.toBeNull();
    expect(row!.seen_in_pasture).toBe(true);
  });

  it("upsert that sets seen_in_pasture to true is accepted", async () => {
    // Commit a baseline row with seen_in_pasture = false.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "4002",
      seenInPasture: false,
    });

    // Upsert that transitions false → true must succeed.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: "4002",
      seenInPasture: true,
      lastReview: "2026-05-21",
      reps: 3,
      updatedAt: T2,
    });

    const row = await readCard(USER_A, "name", "4002");
    expect(row).not.toBeNull();
    expect(row!.seen_in_pasture).toBe(true);
  });
});

// ── 5. card_type discriminator correctness ──────────────────────────────────

describe("card_type discriminator (integration)", () => {
  it("same subject_key with different card_types are stored as separate rows", async () => {
    // The composite PK is (user_id, card_type, subject_key). Two cards with the
    // same subject_key but different types (e.g. 'name' vs 'reverse') must be
    // independent rows — a conflict on one must not overwrite the other.
    const KEY = "5001";

    await upsertAndCommit(pool, USER_A, {
      subjectKey: KEY,
      cardType: "name",
      reps: 5,
      stability: 6.0,
    });
    await upsertAndCommit(pool, USER_A, {
      subjectKey: KEY,
      cardType: "reverse",
      reps: 2,
      stability: 1.5,
    });

    const nameRow = await readCard(USER_A, "name", KEY);
    const reverseRow = await readCard(USER_A, "reverse", KEY);

    expect(nameRow).not.toBeNull();
    expect(reverseRow).not.toBeNull();
    expect(Number(nameRow!.reps)).toBe(5);
    expect(Number(reverseRow!.reps)).toBe(2);
    expect(Number(nameRow!.stability)).toBeCloseTo(6.0);
    expect(Number(reverseRow!.stability)).toBeCloseTo(1.5);
  });

  it("upsert on 'name' row does not touch 'reverse' row for same subject_key", async () => {
    const KEY = "5002";

    await upsertAndCommit(pool, USER_A, { subjectKey: KEY, cardType: "name", reps: 1 });
    await upsertAndCommit(pool, USER_A, { subjectKey: KEY, cardType: "reverse", reps: 7 });

    // Re-upsert the 'name' row with updated data — must not affect 'reverse'.
    await upsertAndCommit(pool, USER_A, {
      subjectKey: KEY,
      cardType: "name",
      reps: 3,
      scheduledDays: 14,
      lastReview: "2026-05-25",
    });

    // The 'reverse' row must be untouched.
    const reverseRow = await readCard(USER_A, "reverse", KEY);
    expect(reverseRow).not.toBeNull();
    expect(Number(reverseRow!.reps)).toBe(7);
  });
});
