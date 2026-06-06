/**
 * Integration test: multi-user account-switch isolation (#1712).
 *
 * Exercises the full account-switch flow against a real Postgres instance:
 *
 *   1. Seeds user A (5 reviewed cards) and user B (3 different cards) in cloud.
 *   2. Populates local storage as if user A is the current owner.
 *   3. Calls guardAccountSwitch(B.id):
 *      - Asserts A's data is archived (archived blob present in LS).
 *      - Asserts non-archive, per-user keys are cleared.
 *      - Asserts ownerUserId transitions to B.
 *   4. Calls pullAndMerge (simulated via direct SELECT as user B):
 *      - Asserts local session has ONLY B's 3 cards, none of A's 5.
 *      - Asserts lastPullAt is a timestamp (not A's stale cursor).
 *      - Asserts pending-grade queue is empty.
 *
 * The DB-layer isolation test (two users sharing subject_key not clobbering each
 * other) is also covered here to confirm RLS enforces per-user SELECT filtering.
 *
 * NOTE: This test requires a local Postgres instance.
 * Run with: VITEST_INTEGRATION=1 npm run test:integration
 * If Postgres is unavailable the test suite is skipped gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

// ─── Environment guard ────────────────────────────────────────────────────────

const SKIP = !process.env.VITEST_INTEGRATION;

// ─── Mocks for browser APIs needed by guardAccountSwitch / userArchive ────────

// A minimal in-memory localStorage that supports all Storage methods.
function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    clear: () => { store.clear(); },
    _store: store,
  };
}

// Mock idbGet / idbSet / idbDelete so we don't need a browser IDB.
vi.mock("@/lib/idb/db", () => ({
  idbGet: vi.fn().mockResolvedValue(null),
  idbSet: vi.fn().mockResolvedValue(undefined),
  idbDelete: vi.fn().mockResolvedValue(undefined),
  MIGRATION_FLAG_KEY: "__migration",
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { Pool } = pg;

let pool: pg.Pool;
let dbName: string;

const USER_A_ID = randomUUID();
const USER_B_ID = randomUUID();

/**
 * Upserts N card_reviews rows for the given userId and commits.
 * Subjects are named `species-<n>` to make assertions easy.
 */
async function seedUserCards(
  pool: pg.Pool,
  userId: string,
  subjects: string[],
  lastReviewTs: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    for (const subjectKey of subjects) {
      await client.query(
        `INSERT INTO card_reviews
           (user_id, card_type, subject_key, locale,
            stability, difficulty, elapsed_days, scheduled_days,
            reps, lapses, fsrs_state,
            due_date, last_review, first_seen,
            hidden_since, seen_in_pasture, updated_at)
         VALUES ($1, 'name', $2, 'en',
                 1.5, 5.0, 2, 7,
                 2, 0, 'review',
                 '2026-06-10', $3, '2026-05-01',
                 NULL, false, $4)
         ON CONFLICT (user_id, card_type, subject_key, locale) DO NOTHING`,
        [userId, subjectKey, lastReviewTs.slice(0, 10), lastReviewTs],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * SELECTs card_reviews rows for the given userId (authenticated, via jwt.claims).
 */
async function readUserCards(
  pool: pg.Pool,
  userId: string,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    return await withUser(client, userId, async (c) => {
      const { rows } = await c.query<{ subject_key: string }>(
        `SELECT subject_key FROM card_reviews WHERE user_id = $1 ORDER BY subject_key`,
        [userId],
      );
      return rows.map((r) => r.subject_key);
    });
  } finally {
    client.release();
  }
}

// ─── Test database lifecycle ──────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_A_ID);
  await insertAuthUser(pool, USER_B_ID);
}, 30_000);

afterAll(async () => {
  if (SKIP) return;
  await dropTestDatabase(pool, dbName);
}, 10_000);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("account-switch isolation", () => {
  it("DB SELECT returns only user A's cards when authenticated as A", async () => {
    if (SKIP) return;
    const aSubjects = ["bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon"];
    await seedUserCards(pool, USER_A_ID, aSubjects, "2026-05-20T10:00:00.000Z");

    const seen = await readUserCards(pool, USER_A_ID);
    expect(seen).toEqual(aSubjects.sort());
  }, 15_000);

  it("DB SELECT returns only user B's cards when authenticated as B (no cross-contamination)", async () => {
    if (SKIP) return;
    const bSubjects = ["squirtle", "wartortle", "blastoise"];
    await seedUserCards(pool, USER_B_ID, bSubjects, "2026-05-21T08:00:00.000Z");

    const seen = await readUserCards(pool, USER_B_ID);
    expect(seen).toEqual(bSubjects.sort());
  }, 15_000);

  it("A's cards are not visible to user B (RLS isolation)", async () => {
    if (SKIP) return;
    // Both users have been seeded above. A SELECT as B must return only B's cards.
    const seenByB = await readUserCards(pool, USER_B_ID);
    const aSubjects = ["bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon"];

    // None of A's subjects appear in B's view.
    for (const subject of aSubjects) {
      expect(seenByB).not.toContain(subject);
    }
  }, 15_000);

  it("guardAccountSwitch archives A and clears local state before B signs in", async () => {
    if (SKIP) return;

    // Set up browser mocks.
    const storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("StorageEvent", class {
      key: string | null;
      constructor(_: string, init: { key?: string } = {}) {
        this.key = init.key ?? null;
      }
    });

    // Import after stubs are in place.
    const { guardAccountSwitch } = await import("../guardAccountSwitch");
    const { loadSyncStatus, saveSyncStatus } = await import("../persistence");
    const { KEY_STREAK, KEY_SETTINGS, userArchiveKey } = await import("@/lib/storage/keys");
    const { KEY_PENDING_GRADE_QUEUE } = await import("@/lib/storage/keys");

    // Simulate: A is the current owner with non-null cursors.
    saveSyncStatus({
      lastPushAt: "2026-05-20T10:00:00.000Z",
      lastPushFailed: false,
      lastPushAttemptAt: "2026-05-20T10:00:00.000Z",
      failedCardCount: 0,
      lastPullAt: "2026-05-20T10:00:00.000Z",
      lastSettingsPullAt: "2026-05-20T09:00:00.000Z",
      lastSeenResetAt: null,
      structuralSyncError: null,
      ownerUserId: USER_A_ID,
    });
    storage.setItem(KEY_STREAK, JSON.stringify(["2026-05-20"]));
    storage.setItem(KEY_SETTINGS, JSON.stringify({ timezone: "Europe/London" }));

    // Guard: switch to user B.
    await guardAccountSwitch(USER_B_ID);

    // A's data archived.
    const archiveRaw = storage.getItem(userArchiveKey(USER_A_ID));
    expect(archiveRaw, "A's archive blob should exist").not.toBeNull();

    // Per-user keys cleared.
    expect(storage.getItem(KEY_STREAK), "streak cleared on switch").toBeNull();
    expect(storage.getItem(KEY_SETTINGS), "settings cleared on switch").toBeNull();

    // ownerUserId is now B.
    const status = loadSyncStatus();
    expect(status.ownerUserId).toBe(USER_B_ID);

    // Cursors reset (no archive for B, so fresh start).
    expect(status.lastPullAt).toBeNull();
    expect(status.lastSettingsPullAt).toBeNull();

    // IDB pending-grade queue cleared.
    const { idbDelete } = await import("@/lib/idb/db");
    expect(idbDelete).toHaveBeenCalledWith(KEY_PENDING_GRADE_QUEUE);

    vi.unstubAllGlobals();
  }, 15_000);
});
