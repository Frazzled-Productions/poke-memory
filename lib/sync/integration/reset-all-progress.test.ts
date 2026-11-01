/**
 * Integration test: `reset_all_progress` (migrations 018, 022, 026).
 *
 * The RPC deletes the caller's card_reviews, grade_log and streak_days, stamps
 * the `user_settings.last_reset_at` tombstone, and refuses a second call within
 * five seconds. Settings and the account survive by design (docs/sync.md).
 *
 * The tombstone triggers themselves are in regression-trigger.test.ts, driven
 * by a hand-written `last_reset_at`; here the real RPC writes the tombstone.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import {
  PROGRESS_TABLES,
  USER_TABLES,
  callRpcAs,
  readUserRows,
  seedProgressRows,
  seedUserRows,
} from "./userRows";

let pool: pg.Pool;
let dbName: string;

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

async function newSeededUser(): Promise<string> {
  const userId = randomUUID();
  await insertAuthUser(pool, userId);
  await seedUserRows(pool, userId);
  return userId;
}

const reset = (userId: string) =>
  callRpcAs(pool, "reset_all_progress", "authenticated", userId);

async function settingsRow(userId: string) {
  const { rows } = await pool.query(
    `SELECT settings, last_reset_at FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

/** Moves the tombstone into the past, as if the last reset was `seconds` ago. */
async function ageTombstone(userId: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE user_settings
     SET last_reset_at = now() - make_interval(secs => $2)
     WHERE user_id = $1`,
    [userId, seconds],
  );
}

describe("reset_all_progress (integration)", () => {
  it("deletes the caller's progress from all three tables", async () => {
    const userA = await newSeededUser();

    const seeded = await readUserRows(pool, userA);
    for (const table of PROGRESS_TABLES) {
      expect(seeded[table], `seed for ${table}`).not.toEqual([]);
    }

    await reset(userA);

    const after = await readUserRows(pool, userA);
    for (const table of PROGRESS_TABLES) {
      expect(after[table], `rows left in ${table}`).toEqual([]);
    }
  });

  it("keeps everything that is not progress: the account, settings, push, feedback, username", async () => {
    const userA = await newSeededUser();
    const before = await readUserRows(pool, userA);
    const settingsBefore = await settingsRow(userA);

    await reset(userA);

    const after = await readUserRows(pool, userA);
    // user_settings is compared below: its tombstone is meant to change.
    const kept = USER_TABLES.filter(
      (t) => t !== "user_settings" && !PROGRESS_TABLES.some((p) => p === t),
    );
    for (const table of kept) {
      expect(after[table], table).toEqual(before[table]);
    }

    expect((await settingsRow(userA)).settings).toEqual(
      settingsBefore.settings,
    );
    const { rowCount } = await pool.query(
      `SELECT 1 FROM auth.users WHERE id = $1`,
      [userA],
    );
    expect(rowCount).toBe(1);
  });

  it("leaves another user untouched", async () => {
    const userA = await newSeededUser();
    const userB = await newSeededUser();
    const userBBefore = await readUserRows(pool, userB);

    await reset(userA);

    expect(await readUserRows(pool, userB)).toEqual(userBBefore);
  });

  it("stamps last_reset_at at the moment of the reset", async () => {
    const userA = await newSeededUser();
    expect((await settingsRow(userA)).last_reset_at).toBeNull();

    await reset(userA);

    const { rows } = await pool.query(
      `SELECT now() - last_reset_at < interval '1 minute' AS recent
       FROM user_settings WHERE user_id = $1`,
      [userA],
    );
    expect(rows[0].recent).toBe(true);
  });

  it("creates the settings row, with empty settings, for a user who has none", async () => {
    const userA = randomUUID();
    await insertAuthUser(pool, userA);
    await seedProgressRows(pool, userA);
    expect(await settingsRow(userA)).toBeUndefined();

    await reset(userA);

    const row = await settingsRow(userA);
    expect(row.settings).toEqual({});
    expect(row.last_reset_at).not.toBeNull();
  });

  it("makes the tombstone reject a stale client's pre-reset writes", async () => {
    const userA = await newSeededUser();
    await reset(userA);

    // 30 days back, so the write is stale even if the test straddles midnight.
    await expect(
      pool.query(
        `INSERT INTO streak_days (user_id, review_date)
         VALUES ($1, CURRENT_DATE - 30)`,
        [userA],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: expect.stringContaining("before last_reset_at"),
    });
  });

  it("refuses a second call within the cooldown and deletes nothing", async () => {
    const userA = await newSeededUser();
    await reset(userA);
    await seedProgressRows(pool, userA);
    const before = await readUserRows(pool, userA);

    await expect(reset(userA)).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringContaining("cooldown active"),
    });

    expect(await readUserRows(pool, userA)).toEqual(before);
  });

  it("allows another reset once the cooldown has passed", async () => {
    const userA = await newSeededUser();
    await reset(userA);
    await seedProgressRows(pool, userA);
    await ageTombstone(userA, 6);

    await expect(reset(userA)).resolves.toBeUndefined();

    const after = await readUserRows(pool, userA);
    for (const table of PROGRESS_TABLES) {
      expect(after[table], `rows left in ${table}`).toEqual([]);
    }
  });

  it("still applies the cooldown two seconds after a reset", async () => {
    const userA = await newSeededUser();
    await reset(userA);
    await ageTombstone(userA, 2);

    await expect(reset(userA)).rejects.toMatchObject({ code: "P0001" });
  });

  it("refuses the anon role, which has no EXECUTE grant", async () => {
    const userA = await newSeededUser();
    const before = await readUserRows(pool, userA);

    await expect(
      callRpcAs(pool, "reset_all_progress", "anon", userA),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining("permission denied for function"),
    });

    expect(await readUserRows(pool, userA)).toEqual(before);
  });

  it("refuses a session with no subject and deletes nothing", async () => {
    const userA = await newSeededUser();
    const before = await readUserRows(pool, userA);

    await expect(
      callRpcAs(pool, "reset_all_progress", "authenticated", null),
    ).rejects.toMatchObject({
      code: "42501",
      message: "reset_all_progress requires an authenticated session",
    });

    expect(await readUserRows(pool, userA)).toEqual(before);
  });
});
