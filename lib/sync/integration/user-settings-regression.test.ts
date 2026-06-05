/**
 * Integration test: user_settings_reject_regression_trigger (migration 038).
 *
 * Verifies that the DB-level trigger blocks any write that destroys user data:
 *   - streakProtection.spendDates: entries cannot be removed.
 *   - streakProtection.balance: cannot decrease unless new spend entries are added.
 *   - earnedBadges: badge ids cannot be removed (id-level, not length).
 *   - onboarding dismissal flags: once true, cannot revert to false or absent.
 *   - onboarding monotonic counters: practiceSessionsCount, slowSpriteLoadCount
 *     can only increase.
 *   - learningLocales: a locale cannot be removed unless tombstoned in removedLocales.
 *
 * Also verifies that the deep-merge helper (migration 036) is wired into
 * merge_user_settings (migration 037): a patch touching one nested key must leave
 * siblings intact.
 *
 * Each test gets its own user_id so seedSettings always runs as an INSERT
 * (never an ON CONFLICT UPDATE), keeping the trigger logic focused on the
 * test assertions and avoiding cross-test state pollution.
 *
 * All writes use direct SQL via pg. The `withUser` helper wraps each assertion in a
 * transaction that is always rolled back, providing test isolation.
 * `set_config('request.jwt.claims', ...)` makes `auth.uid()` return the test
 * user's UUID, satisfying RLS policies.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

// Each test gets its own user_id so seedSettings is always an INSERT.
let testUserId: string;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed user_settings for testUserId via a direct INSERT.
 * Because each test has a fresh testUserId, this is always an INSERT (never an
 * UPDATE), so the BEFORE UPDATE trigger does not fire here. Tests then perform
 * UPDATEs that are subject to the trigger.
 */
async function seedSettings(settings: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO public.user_settings (user_id, settings, updated_at)
     VALUES ($1, $2::jsonb, now())`,
    [testUserId, JSON.stringify(settings)],
  );
}

/**
 * Call merge_user_settings via direct SQL inside a withUser transaction.
 * Returns the promise so callers can wrap in expect().rejects / .resolves.
 */
async function mergeViaRpc(
  client: pg.PoolClient,
  userId: string,
  patch: Record<string, unknown>,
): Promise<pg.QueryResult> {
  return client.query(
    `SELECT public.merge_user_settings($1::uuid, $2::jsonb)`,
    [userId, JSON.stringify(patch)],
  );
}

/**
 * Update user_settings directly (bypassing the RPC) to test the trigger in
 * isolation. Runs inside a withUser transaction.
 */
async function directUpdate(
  client: pg.PoolClient,
  userId: string,
  settings: Record<string, unknown>,
): Promise<pg.QueryResult> {
  return client.query(
    `UPDATE public.user_settings SET settings = $2::jsonb WHERE user_id = $1`,
    [userId, JSON.stringify(settings)],
  );
}

/**
 * Read the committed settings blob for a user_id.
 */
async function readSettings(userId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT settings FROM public.user_settings WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  return rows[0].settings as Record<string, unknown> | null;
}

/** Minimal streak protection blob with no tokens or spends. */
const ZERO_STREAK = {
  balance: 0,
  spendDates: [],
  daysSinceLastEarn: 0,
  lastEarnCheckDate: null,
  protectionEvents: [],
  lastAcknowledgedProtectionEventDate: null,
};

// ── test setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
}, 60_000);

beforeEach(async () => {
  // Fresh user_id per test: seedSettings is always a clean INSERT.
  testUserId = randomUUID();
  await insertAuthUser(pool, testUserId);
});

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

// ── REJECT cases ─────────────────────────────────────────────────────────────

describe("user_settings_reject_regression_trigger (integration)", () => {
  describe("REJECT: trigger blocks destructive writes", () => {
    it("rejects UPDATE that removes a spendDate", async () => {
      await seedSettings({
        streakProtection: { ...ZERO_STREAK, spendDates: ["2026-05-01"] },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: { ...ZERO_STREAK, spendDates: [] }, // removed "2026-05-01"
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that drops balance without adding a new spendDate", async () => {
      await seedSettings({
        streakProtection: { ...ZERO_STREAK, balance: 2, spendDates: ["2026-05-01"] },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              // balance dropped by 1 but no new spend date
              streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-01"] },
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that removes an earnedBadge by id", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [{ id: "badge-1", earnedAt: "2026-05-01T00:00:00Z" }],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [], // "badge-1" removed
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that swaps an earnedBadge id (same array length, different id)", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [{ id: "badge-original", earnedAt: "2026-05-01T00:00:00Z" }],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              // Same length but "badge-original" is absent.
              earnedBadges: [{ id: "badge-different", earnedAt: "2026-05-02T00:00:00Z" }],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that sets an onboarding flag from true to false", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: false, // reverted to false
                practiceSessionsCount: 0,
                slowSpriteLoadCount: 0,
              },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that removes an onboarding flag that was true (absent = non-true)", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          statsHintDismissed: true,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              // statsHintDismissed absent = null cast to boolean = false
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that decreases practiceSessionsCount", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 5, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 3, slowSpriteLoadCount: 0 }, // decreased
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that decreases slowSpriteLoadCount", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 4 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 2 }, // decreased
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that removes a learningLocale without a tombstone", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en", "ja"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"], // "ja" removed without tombstone
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that sets typedEntryOnboardingShown from true to false", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        typedEntryOnboardingShown: true,
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              typedEntryOnboardingShown: false, // reverted to false
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that sets mcCardOnboardingShown from true to false", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        mcCardOnboardingShown: true,
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              mcCardOnboardingShown: false, // reverted to false
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects UPDATE that nulls streakProtection (absent streakProtection with existing spend dates)", async () => {
      await seedSettings({
        streakProtection: {
          balance: 3,
          spendDates: ["2026-05-01", "2026-05-10"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
          protectionEvents: [],
          lastAcknowledgedProtectionEventDate: null,
        },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              // streakProtection absent: trigger treats as {}, balance 3->0 with no new spends.
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });
  });

  // ── ALLOW cases ──────────────────────────────────────────────────────────────

  describe("ALLOW: trigger permits legitimate writes", () => {
    it("allows dismissing more onboarding flags", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          statsHintDismissed: false,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: true, // unchanged
                statsHintDismissed: true,            // newly dismissed
                practiceSessionsCount: 0,
                slowSpriteLoadCount: 0,
              },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows a token spend: balance decreases AND new spendDate is added", async () => {
      await seedSettings({
        streakProtection: { ...ZERO_STREAK, balance: 2, spendDates: ["2026-05-01"] },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: {
                ...ZERO_STREAK,
                balance: 1, // decreased by 1
                spendDates: ["2026-05-01", "2026-05-20"], // new spend date added
              },
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows a token earn: balance increases", async () => {
      await seedSettings({
        streakProtection: { ...ZERO_STREAK, balance: 1, spendDates: ["2026-05-01"] },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: {
                ...ZERO_STREAK,
                balance: 2, // increased
                spendDates: ["2026-05-01"],
              },
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows earning a badge", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [{ id: "badge-a", earnedAt: "2026-05-01T00:00:00Z" }],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [
                { id: "badge-a", earnedAt: "2026-05-01T00:00:00Z" },
                { id: "badge-b", earnedAt: "2026-05-20T00:00:00Z" }, // new badge
              ],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows removing a learningLocale WITH a tombstone in removedLocales", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en", "zh-Hans"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],         // "zh-Hans" removed from learning
              removedLocales: ["zh-Hans"],     // but tombstoned here
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows increasing a monotonic counter", async () => {
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 3, slowSpriteLoadCount: 2 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 4, slowSpriteLoadCount: 3 }, // both increased
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows a settings-unchanged UPDATE (regional-prefs style no-op)", async () => {
      // Simulate what pushRegionalPrefs does: touches only scalar columns,
      // settings JSONB is unchanged. The trigger must pass.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          // Read and write back the same settings blob.
          const { rows } = await c.query(
            `SELECT settings FROM public.user_settings WHERE user_id = $1`,
            [testUserId],
          );
          const currentSettings = rows[0].settings as Record<string, unknown>;
          await expect(
            directUpdate(c, testUserId, currentSettings),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows deep-merge preserving sibling onboarding keys (merge RPC positive test)", async () => {
      // Seed with firstVisitOnboardingDismissed = true and practiceSessionsCount = 5.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          statsHintDismissed: false,
          practiceSessionsCount: 5,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        // Push a patch that only touches statsHintDismissed inside onboarding.
        // Deep-merge must leave firstVisitOnboardingDismissed and
        // practiceSessionsCount intact.
        await mergeViaRpc(client, testUserId, {
          onboarding: { statsHintDismissed: true },
        });
      } finally {
        client.release();
      }
      const result = await readSettings(testUserId);
      expect(result).not.toBeNull();
      const onb = result!.onboarding as Record<string, unknown>;
      // sibling key preserved by deep-merge
      expect(onb.firstVisitOnboardingDismissed).toBe(true);
      expect(onb.practiceSessionsCount).toBe(5);
      // patched key was set
      expect(onb.statsHintDismissed).toBe(true);
    });

    // ── additive-restore ALLOW tests ─────────────────────────────────────────
    // These are the proof that fixing a live incident (re-adding data that was
    // correctly present) is not blocked by the trigger.

    it("ALLOW additive-restore: re-add a spendDate and raise balance", async () => {
      // A recovery scenario: the cloud lost a spend date (pre-trigger). After the
      // trigger is deployed, a client re-pushes the correct state. The trigger
      // sees OLD.spendDates = [] and NEW.spendDates = ["2026-05-01"]: purely additive.
      await seedSettings({
        streakProtection: { ...ZERO_STREAK, balance: 0, spendDates: [] },
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: {
                ...ZERO_STREAK,
                balance: 1, // going up
                spendDates: ["2026-05-01"], // adding a date
              },
              earnedBadges: [],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("ALLOW additive-restore: re-earn a badge after accidental loss", async () => {
      // Cloud has no badges (accidental loss); client pushes the badge back.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [{ id: "badge-recovered", earnedAt: "2026-05-01T00:00:00Z" }],
              onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("ALLOW additive-restore: re-dismiss an onboarding flag after accidental reset", async () => {
      // Cloud shows flag as false (lost); client sends true. This is purely additive.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: false,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: true, // false -> true: additive
                practiceSessionsCount: 0,
                slowSpriteLoadCount: 0,
              },
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("ALLOW additive-restore: fresh row with absent streakProtection is accepted", async () => {
      // A brand-new user's first push arrives without streakProtection at all.
      // The INSERT path never hits the trigger (trigger is BEFORE UPDATE only).
      // This tests that a subsequent UPDATE on a row with no streakProtection
      // (in either OLD or NEW) is accepted.
      await seedSettings({
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        learningLocales: ["en"],
        removedLocales: [],
        // no streakProtection key
      });
      // Update by adding a different top-level key - no streakProtection in either OLD or NEW.
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            c.query(
              `UPDATE public.user_settings SET settings = settings || '{"masteryRepetitions":4}'::jsonb WHERE user_id = $1`,
              [testUserId],
            ),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("allows onboarding flag reset when onboardingResetAt is strictly newer", async () => {
      // Simulates the "Show onboarding again" button: client sends a newer
      // onboardingResetAt alongside the zeroed-out onboarding object.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          statsHintDismissed: true,
          practiceSessionsCount: 5,
          slowSpriteLoadCount: 2,
        },
        onboardingResetAt: "2026-06-01T10:00:00.000Z",
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: false, // reverted
                statsHintDismissed: false,            // reverted
                practiceSessionsCount: 0,             // zeroed
                slowSpriteLoadCount: 0,               // zeroed
              },
              // Strictly newer than the seeded "2026-06-01T10:00:00.000Z"
              onboardingResetAt: "2026-06-05T12:00:00.000Z",
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });

    it("rejects onboarding flag reset when onboardingResetAt is absent (no tombstone)", async () => {
      // Without the tombstone, a true->false flip is still blocked even if the
      // caller is sending the same values as the reset button; there's no signal
      // that this is user-intentional.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: false, // reverted, no tombstone
                practiceSessionsCount: 0,
                slowSpriteLoadCount: 0,
              },
              // onboardingResetAt absent
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("rejects onboarding flag reset when onboardingResetAt is the same as existing (not strictly newer)", async () => {
      // A stale client replaying an old reset (same timestamp) must not bypass
      // the guard: the tombstone check requires a strictly-newer value.
      await seedSettings({
        streakProtection: ZERO_STREAK,
        earnedBadges: [],
        onboarding: {
          firstVisitOnboardingDismissed: true,
          practiceSessionsCount: 0,
          slowSpriteLoadCount: 0,
        },
        onboardingResetAt: "2026-06-05T12:00:00.000Z",
        learningLocales: ["en"],
        removedLocales: [],
      });
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            directUpdate(c, testUserId, {
              streakProtection: ZERO_STREAK,
              earnedBadges: [],
              onboarding: {
                firstVisitOnboardingDismissed: false, // reverted
                practiceSessionsCount: 0,
                slowSpriteLoadCount: 0,
              },
              onboardingResetAt: "2026-06-05T12:00:00.000Z", // same, not newer
              learningLocales: ["en"],
              removedLocales: [],
            }),
          ).rejects.toThrow();
        });
      } finally {
        client.release();
      }
    });

    it("ALLOW additive-restore: pre-#1484 row with absent learningLocales is accepted", async () => {
      // Simulates a row from before learningLocales was shipped: the column is absent.
      // The trigger must treat absent OLD.learningLocales as '["en"]' (default),
      // and absent NEW.learningLocales as '["en"]' too, so no locale is removed.
      await seedSettings({
        earnedBadges: [],
        onboarding: { practiceSessionsCount: 0, slowSpriteLoadCount: 0 },
        // no learningLocales key
      });
      // Update the row (no learningLocales in either OLD or NEW).
      const client = await pool.connect();
      try {
        await withUser(client, testUserId, async (c) => {
          await expect(
            c.query(
              `UPDATE public.user_settings SET settings = settings || '{"masteryRepetitions":3}'::jsonb WHERE user_id = $1`,
              [testUserId],
            ),
          ).resolves.toBeDefined();
        });
      } finally {
        client.release();
      }
    });
  });
});
