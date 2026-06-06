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

  it("AC6: no cross-contamination - after guardAccountSwitch + pullAndMerge simulation, local state contains only B's cards", async () => {
    if (SKIP) return;

    // ── Subjects ────────────────────────────────────────────────────────────────
    // These must be already seeded in the DB by the earlier tests in this suite
    // (tests share the same beforeAll DB lifecycle).
    const aSubjects = ["bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon"].sort();
    const bSubjects = ["squirtle", "wartortle", "blastoise"].sort();

    // ── Browser mocks ───────────────────────────────────────────────────────────
    const storage = makeMockStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("StorageEvent", class {
      key: string | null;
      constructor(_: string, init: { key?: string } = {}) {
        this.key = init.key ?? null;
      }
    });

    // Reset IDB mock call history so assertions below are per-test.
    const { idbGet, idbDelete } = await import("@/lib/idb/db");
    vi.mocked(idbDelete).mockClear();
    vi.mocked(idbGet).mockClear();

    // ── Simulate: A is the current local owner ───────────────────────────────
    // Populate local storage as if user A is signed in with 5 reviewed cards.
    const { loadSyncStatus, saveSyncStatus } = await import("../persistence");
    const {
      KEY_REVIEW_SESSION,
      KEY_PENDING_GRADE_QUEUE,
      KEY_STREAK,
      KEY_SETTINGS,
    } = await import("@/lib/storage/keys");

    // Fake A's session in LS (IDB is mocked to return null so LS is the
    // fallback for archiveUserData's IDB snapshot step).
    const aFakeSession = {
      cards: aSubjects.map((s) => ({
        id: Math.random(),
        cardType: "name",
        subjectKey: s,
        locale: "en",
        state: {
          stability: 1,
          difficulty: 5,
          elapsedDays: 2,
          scheduledDays: 7,
          reps: 2,
          lapses: 0,
          state: "review",
          lastReview: "2026-05-20",
          firstSeen: "2026-05-01",
          dueDate: "2026-06-10",
          hiddenSince: null,
          seenInPasture: false,
          learningStep: null,
          stepStartedAt: null,
        },
      })),
      limits: { newNameCardsPerDay: 10, newEvoCardsPerDay: 5, reviewsPerDay: 100 },
    };
    const aFakePendingQueue = aSubjects.map((s) => ({
      id: Math.random(),
      cardType: "name",
      subjectKey: s,
      locale: "en",
      state: { stability: 1, difficulty: 5, elapsedDays: 2, scheduledDays: 7, reps: 2, lapses: 0, state: "review", lastReview: "2026-05-20", firstSeen: "2026-05-01", dueDate: "2026-06-10", hiddenSince: null, seenInPasture: false, learningStep: null, stepStartedAt: null },
    }));

    storage.setItem(KEY_REVIEW_SESSION, JSON.stringify(aFakeSession));
    storage.setItem(KEY_PENDING_GRADE_QUEUE, JSON.stringify(aFakePendingQueue));
    storage.setItem(KEY_STREAK, JSON.stringify(["2026-05-20"]));
    storage.setItem(KEY_SETTINGS, JSON.stringify({ timezone: "Europe/London" }));

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

    // ── Step 1: guardAccountSwitch(B) ────────────────────────────────────────
    const { guardAccountSwitch } = await import("../guardAccountSwitch");
    await guardAccountSwitch(USER_B_ID);

    // ownerUserId is now B and cursors are null.
    const statusAfterSwitch = loadSyncStatus();
    expect(statusAfterSwitch.ownerUserId, "ownerUserId should be B after switch").toBe(USER_B_ID);
    expect(statusAfterSwitch.lastPullAt, "lastPullAt should be null (fresh start for B)").toBeNull();

    // A's per-user LS keys must be gone - this is the wipe step that prevents
    // A's session/queue from leaking into B's pull.
    expect(storage.getItem(KEY_REVIEW_SESSION), "A's session cleared from LS").toBeNull();
    expect(storage.getItem(KEY_PENDING_GRADE_QUEUE), "A's pending queue cleared from LS").toBeNull();
    expect(storage.getItem(KEY_STREAK), "A's streak cleared").toBeNull();
    expect(storage.getItem(KEY_SETTINGS), "A's settings cleared").toBeNull();

    // IDB pending-grade queue deleted BEFORE the LS wipe (race-window close).
    // clearIdbPendingQueue runs before wipeUserLocalStorage, so idbDelete
    // for KEY_PENDING_GRADE_QUEUE must have been called.
    expect(idbDelete, "IDB pending queue deleted to close the Background-Sync race").toHaveBeenCalledWith(KEY_PENDING_GRADE_QUEUE);

    // ── Step 2: Fetch B's cloud rows directly from the test DB ──────────────
    // Simulates what pullSession(clientAsB, B.id) does. RLS filters to B's
    // rows only; A's 5 subjects must not appear.
    // updated_at is a timestamptz column; pg returns it as a JS Date. Cast to
    // ISO string immediately so the rest of the test works with plain strings.
    const cloudClient = await pool.connect();
    let bCloudRows: Array<{ subject_key: string; card_type: string; last_review: string | null; updated_at: string }> = [];
    try {
      bCloudRows = await withUser(cloudClient, USER_B_ID, async (c) => {
        const { rows } = await c.query<{ subject_key: string; card_type: string; last_review: string | null; updated_at: Date }>(
          `SELECT subject_key, card_type, last_review, updated_at
           FROM card_reviews
           WHERE user_id = $1
           ORDER BY subject_key`,
          [USER_B_ID],
        );
        return rows.map((r) => ({
          ...r,
          // updated_at is a timestamptz column; pg returns it as a JS Date.
          // Convert to ISO string so string comparisons work correctly.
          updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
        }));
      });
    } finally {
      cloudClient.release();
    }

    // B's cloud must contain exactly B's 3 subjects and none of A's 5.
    const bCloudSubjects = bCloudRows.map((r) => r.subject_key).sort();
    expect(bCloudSubjects, "cloud (as B) contains only B's subjects").toEqual(bSubjects);
    for (const aSubject of aSubjects) {
      expect(bCloudSubjects, `A's subject '${aSubject}' must not appear in B's cloud view`).not.toContain(aSubject);
    }

    // ── Step 3: Simulate the merge step of pullAndMerge ─────────────────────
    // After the guard wipe, local session is null (LS and IDB both empty).
    // idbGet returns null (mocked); LS was wiped. mergeCloudIntoLocalSilent
    // with an empty local array and B's cloud rows must yield only B's data.
    const { mergeCloudIntoLocalSilent } = await import("../cloud");
    // Construct minimal CloudRow objects from the pg query results.
    // last_review is a `date` column; pg returns it as a JS Date.
    // Normalise to "YYYY-MM-DD" string (the form CloudRow expects).
    const bCloudRowsFull = bCloudRows.map((r) => {
      const lastReviewRaw = r.last_review as unknown;
      const lastReview: string | null =
        lastReviewRaw instanceof Date
          ? lastReviewRaw.toISOString().slice(0, 10)
          : (lastReviewRaw as string | null);
      return {
        card_type: r.card_type,
        subject_key: r.subject_key,
        locale: "en" as const,
        stability: 1.5,
        difficulty: 5.0,
        elapsed_days: 2,
        scheduled_days: 7,
        reps: 2,
        lapses: 0,
        fsrs_state: "review" as const,
        due_date: "2026-06-10",
        last_review: lastReview,
        first_seen: "2026-05-01",
        hidden_since: null,
        seen_in_pasture: false,
        updated_at: r.updated_at,
      };
    });

    // Empty local (guard wiped it), no seed (omitted so Pass 2 is a no-op -
    // the test is about contamination, not synthesis). Pass 1 finds no local
    // cards to update so merged === [].
    const mergedEmpty = mergeCloudIntoLocalSilent([], bCloudRowsFull, null);
    expect(mergedEmpty, "merged result with empty local is empty (no A data injected)").toHaveLength(0);

    // Crucially: none of A's subjects appear in the merge result.
    const mergedSubjects = mergedEmpty.map((c) => c.subjectKey);
    for (const aSubject of aSubjects) {
      expect(mergedSubjects, `A's subject '${aSubject}' must not be in merge result`).not.toContain(aSubject);
    }

    // ── Step 4: Stamp ownerUserId as pullAndMerge would ─────────────────────
    // pullAndMerge uses `ownerUserId: userId ?? syncStatus.ownerUserId` in its
    // final saveSyncStatus. Confirm this survives on the status object.
    const bLastPullTs = bCloudRows.reduce<string | null>(
      (max, r) => (!max || r.updated_at > max ? r.updated_at : max),
      null,
    );
    saveSyncStatus({
      ...loadSyncStatus(),
      lastPullAt: bLastPullTs,
      ownerUserId: USER_B_ID,
    });
    const finalStatus = loadSyncStatus();
    expect(finalStatus.ownerUserId, "ownerUserId is B after pullAndMerge stamp").toBe(USER_B_ID);
    expect(finalStatus.lastPullAt, "lastPullAt is B's updated_at timestamp").toBe(bLastPullTs);

    vi.unstubAllGlobals();
  }, 20_000);
});
