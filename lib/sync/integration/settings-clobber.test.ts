/**
 * Integration test: settings-clobber protection (#1682).
 *
 * Proves, against a REAL Postgres instance with the full migration set applied,
 * that a fresh/default-bearing client CANNOT destroy populated cloud settings
 * by pushing a default-valued sub-object through merge_user_settings.
 *
 * Phase A guarantee (this test): the client never SENDS the destructive patch,
 * because `diffSettings(prev=null, ...)` prunes any top-level key whose value
 * deep-equals `DEFAULT_SETTINGS[key]`. The RPC-level deep-merge + regression-
 * trigger is Phase B (#1683).
 *
 * The harm is VALUE-clobbering a sub-object to its default - NOT top-level key
 * removal. Specifically:
 *   - Cloud has a populated `streakProtection` (spend history, non-zero balance).
 *   - Cloud has `onboarding.firstVisitOnboardingDismissed = true`.
 *   - A fresh device signs in, calls `diffSettings(null, defaultBearingBlob)`,
 *     gets the pruned patch, then pushes it via `merge_user_settings`.
 *   - After the push, the cloud values must be UNCHANGED.
 *
 * The test also asserts the no-prune counterfactual to document WHY the prune
 * matters: pushing the full default-valued blob without pruning WOULD clobber
 * the cloud values.
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
import { diffSettings } from "@/lib/settings/lastPushedSnapshot";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings/persistence";

let pool: pg.Pool;
let dbName: string;
const USER_ID = randomUUID();

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Call the `merge_user_settings(user_id, patch)` RPC directly via SQL,
 * mirroring what `pushSettings` does in production.
 */
async function callMergeRpc(
  client: pg.PoolClient,
  patch: Partial<UserSettings>,
): Promise<void> {
  await client.query(
    `SELECT merge_user_settings($1::uuid, $2::jsonb)`,
    [USER_ID, JSON.stringify(patch)],
  );
}

/**
 * Read the current `settings` JSONB blob for USER_ID.
 * Returns null if the row does not exist.
 */
async function readCloudSettings(
  client: pg.PoolClient,
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query(
    `SELECT settings FROM user_settings WHERE user_id = $1`,
    [USER_ID],
  );
  if (rows.length === 0) return null;
  return rows[0].settings as Record<string, unknown> | null;
}

// ── test setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_ID);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

// ── the test ─────────────────────────────────────────────────────────────────

describe("settings clobber protection (#1682) - integration", () => {
  it("Phase A: a fresh client's first push (prev=null) does NOT clobber populated cloud values", async () => {
    const client = await pool.connect();
    try {
      // ── Step 1: Seed the cloud with a populated user_settings row. ─────────
      //
      // This simulates a veteran user's cloud state: earned streak tokens, a
      // dismissed onboarding flag. These values are richer than their defaults.
      const populatedStreakProtection = {
        balance: 2,
        spendDates: ["2026-05-29"],
        daysSinceLastEarn: 3,
        lastEarnCheckDate: "2026-05-29",
        protectionEvents: [],
        lastAcknowledgedProtectionEventDate: null,
      };
      const populatedOnboarding = {
        ...DEFAULT_SETTINGS.onboarding,
        firstVisitOnboardingDismissed: true,
        statsHintDismissed: true,
      };

      const cloudSeedPatch: Partial<UserSettings> = {
        streakProtection: populatedStreakProtection,
        onboarding: populatedOnboarding,
        masteryRepetitions: 5,
      };

      await callMergeRpc(client, cloudSeedPatch);

      // Verify the seed landed correctly.
      const afterSeed = await readCloudSettings(client);
      expect(afterSeed).not.toBeNull();
      const cloudStreak = afterSeed!.streakProtection as typeof populatedStreakProtection;
      expect(cloudStreak.balance).toBe(2);
      expect(cloudStreak.spendDates).toEqual(["2026-05-29"]);
      const cloudOnboarding = afterSeed!.onboarding as typeof populatedOnboarding;
      expect(cloudOnboarding.firstVisitOnboardingDismissed).toBe(true);
      expect(afterSeed!.masteryRepetitions).toBe(5);

      // ── Step 2: Simulate a fresh/default-bearing device first push. ────────
      //
      // The device has all DEFAULT_SETTINGS (no customisation). `diffSettings`
      // with `prev=null` must prune every key that equals the default, producing
      // an empty patch (or at minimum, NOT including streakProtection/onboarding).
      const defaultBearingBlob: UserSettings = { ...DEFAULT_SETTINGS };
      const patch = diffSettings(null, defaultBearingBlob);

      // The patch must not contain these default sub-objects.
      expect(patch).not.toHaveProperty("streakProtection");
      expect(patch).not.toHaveProperty("onboarding");

      if (Object.keys(patch).length > 0) {
        // Push whatever non-empty patch the diff produces (there may be none).
        await callMergeRpc(client, patch);
      }

      // ── Step 3: Assert the cloud values are intact. ────────────────────────
      const afterFreshPush = await readCloudSettings(client);
      expect(afterFreshPush).not.toBeNull();

      const postStreak = afterFreshPush!.streakProtection as typeof populatedStreakProtection;
      // The critical assertions: populated cloud values must not have been clobbered.
      expect(postStreak.balance).toBe(2);
      expect(postStreak.spendDates).toEqual(["2026-05-29"]);

      const postOnboarding = afterFreshPush!.onboarding as typeof populatedOnboarding;
      expect(postOnboarding.firstVisitOnboardingDismissed).toBe(true);
      expect(postOnboarding.statsHintDismissed).toBe(true);

      // masteryRepetitions is non-default in cloud (5) and was not in the fresh
      // device's default-bearing blob, so it must still be 5.
      expect(afterFreshPush!.masteryRepetitions).toBe(5);
    } finally {
      client.release();
    }
  });

  it("counterfactual: pushing the FULL default-valued blob WITHOUT pruning WOULD clobber cloud values", async () => {
    // This test documents why the prune matters. It uses a separate user to
    // avoid interfering with the passing test above.
    const counterUserId = randomUUID();
    await insertAuthUser(pool, counterUserId);
    const client = await pool.connect();
    try {
      // Seed cloud with a non-default streakProtection.
      const populatedStreak = {
        balance: 1,
        spendDates: ["2026-05-10"],
        daysSinceLastEarn: 5,
        lastEarnCheckDate: "2026-05-10",
        protectionEvents: [],
        lastAcknowledgedProtectionEventDate: null,
      };
      await client.query(
        `SELECT merge_user_settings($1::uuid, $2::jsonb)`,
        [counterUserId, JSON.stringify({ streakProtection: populatedStreak })],
      );

      // Verify the seed.
      const { rows: seedRows } = await client.query(
        `SELECT settings FROM user_settings WHERE user_id = $1`,
        [counterUserId],
      );
      const seedStreak = (seedRows[0].settings as Record<string, unknown>)
        .streakProtection as typeof populatedStreak;
      expect(seedStreak.balance).toBe(1);

      // Simulate the un-fixed behaviour: push the FULL default-bearing blob
      // (no prune) via the RPC. The `||` overlay clobbers streakProtection.
      const unprunedFullBlob = { ...DEFAULT_SETTINGS };
      await client.query(
        `SELECT merge_user_settings($1::uuid, $2::jsonb)`,
        [counterUserId, JSON.stringify(unprunedFullBlob)],
      );

      // The un-pruned push DOES clobber the cloud value (balance returns to 0).
      const { rows: afterRows } = await client.query(
        `SELECT settings FROM user_settings WHERE user_id = $1`,
        [counterUserId],
      );
      const afterStreak = (afterRows[0].settings as Record<string, unknown>)
        .streakProtection as typeof populatedStreak;
      // Without the prune, balance is now 0 - the clobber happened.
      expect(afterStreak.balance).toBe(0);
      expect(afterStreak.spendDates).toEqual([]);
    } finally {
      client.release();
    }
  });
});
