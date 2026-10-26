/**
 * Integration test: the favourite and hearts keys through merge_user_settings
 * (#2187).
 *
 * Proves, against a real Postgres with every migration applied, the SQL half
 * of the change's safety fact:
 *   - a patch that does not carry `heartedSpeciesIds` (what an older app
 *     version pushes, since it never knows the key) leaves the cloud list and
 *     the favourite alone, because `jsonb_deep_merge` (migration 036) keeps
 *     keys absent from the patch;
 *   - an array patch with one item removed does remove it, because the deep
 *     merge replaces arrays whole (which is why the lists are arrays, not
 *     objects), and migration 038's regression trigger does not guard hearts.
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
import type { UserSettings } from "@/lib/settings/persistence";

let pool: pg.Pool;
let dbName: string;
const USER_ID = randomUUID();

async function merge(client: pg.PoolClient, patch: Partial<UserSettings>): Promise<void> {
  await client.query(`SELECT merge_user_settings($1::uuid, $2::jsonb)`, [
    USER_ID,
    JSON.stringify(patch),
  ]);
}

async function cloudSettings(client: pg.PoolClient): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT settings FROM user_settings WHERE user_id = $1`,
    [USER_ID],
  );
  return rows[0].settings as Record<string, unknown>;
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_ID);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("favourite and hearts through merge_user_settings (#2187) - integration", () => {
  it("a patch without heartedSpeciesIds leaves the hearts and the favourite in the cloud row", async () => {
    const client = await pool.connect();
    try {
      await merge(client, {
        favouritePokemonId: 94,
        heartedSpeciesIds: [94, 25, 143],
        priorityNewSpeciesIds: [92, 93],
      });
      // An older app version changes its daily new-card cap: its patch holds
      // only that key.
      await merge(client, { maxNewPerDay: 15 });

      const after = await cloudSettings(client);
      expect(after.maxNewPerDay).toBe(15);
      expect(after.favouritePokemonId).toBe(94);
      expect(after.heartedSpeciesIds).toEqual([94, 25, 143]);
      expect(after.priorityNewSpeciesIds).toEqual([92, 93]);
    } finally {
      client.release();
    }
  });

  it("an array patch with one item removed removes it from the cloud row", async () => {
    const client = await pool.connect();
    try {
      await merge(client, { heartedSpeciesIds: [94, 143] });
      await merge(client, { priorityNewSpeciesIds: [93] });

      const after = await cloudSettings(client);
      expect(after.heartedSpeciesIds).toEqual([94, 143]);
      expect(after.priorityNewSpeciesIds).toEqual([93]);
      expect(after.favouritePokemonId).toBe(94);
    } finally {
      client.release();
    }
  });

  it("clearing the favourite to null reaches the cloud row", async () => {
    const client = await pool.connect();
    try {
      await merge(client, { favouritePokemonId: null });
      const after = await cloudSettings(client);
      expect(after.favouritePokemonId).toBeNull();
      expect(after.heartedSpeciesIds).toEqual([94, 143]);
    } finally {
      client.release();
    }
  });
});
