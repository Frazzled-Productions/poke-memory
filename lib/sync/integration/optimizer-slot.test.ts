/**
 * Integration test: the FSRS optimiser's run slot.
 *
 * Runs the real SQL for public.optimizer_runs and public.claim_optimizer_slot()
 * on local Postgres, as the `authenticated` role with a real claims setting, so
 * RLS, grants and the SECURITY DEFINER path are all the live ones. Grants on
 * tables mirror Supabase's defaults, so a refusal below comes from RLS and not
 * from a missing grant.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
} from "./setup";
import { applyMigrations, listMigrationFiles } from "./applyMigrations";
import { OPTIMIZER_COOLDOWN_MS } from "../../srs/optimizer";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const USER_C = "00000000-0000-0000-0000-00000000000c";
const USER_D = "00000000-0000-0000-0000-00000000000d";
const USER_E = "00000000-0000-0000-0000-00000000000e";
const USER_F = "00000000-0000-0000-0000-00000000000f";
const USER_H = "00000000-0000-0000-0000-000000000011";

const MINUTE_MS = 60_000;

let pool: pg.Pool;
let dbName: string;

/** Runs `fn` in one transaction as `role`, with `uid` as auth.uid(). */
async function asUser<T>(
  uid: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
  role = "authenticated",
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid === null ? {} : { sub: uid }),
    ]);
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** claim_optimizer_slot() as a session for `uid`: 0 claimed, above 0 is ms left. */
async function claim(uid: string): Promise<number> {
  return asUser(uid, async (client) => {
    const res = await client.query<{ retry: string }>(
      `SELECT public.claim_optimizer_slot() AS retry`,
    );
    return Number(res.rows[0].retry);
  });
}

async function setClaimedAgo(uid: string, ms: number): Promise<void> {
  await pool.query(
    `UPDATE public.optimizer_runs
        SET claimed_at = now() - ($2::bigint * interval '1 millisecond')
      WHERE user_id = $1`,
    [uid, ms],
  );
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await pool.query(`
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
  `);
  for (const id of [USER_A, USER_B, USER_C, USER_D, USER_E, USER_F, USER_H]) {
    await pool.query(`INSERT INTO auth.users (id) VALUES ($1)`, [id]);
  }
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("claim_optimizer_slot (integration)", () => {
  it("claims a free slot and stores one row for the session's user", async () => {
    expect(await claim(USER_A)).toBe(0);
    const { rows } = await pool.query(
      `SELECT user_id FROM public.optimizer_runs WHERE user_id = $1`,
      [USER_A],
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a second claim and reports the time left", async () => {
    const retry = await claim(USER_A);
    expect(retry).toBeGreaterThan(OPTIMIZER_COOLDOWN_MS - MINUTE_MS);
    expect(retry).toBeLessThanOrEqual(OPTIMIZER_COOLDOWN_MS);
  });

  it("uses the same window as OPTIMIZER_COOLDOWN_MS", async () => {
    await claim(USER_B);

    await setClaimedAgo(USER_B, OPTIMIZER_COOLDOWN_MS - MINUTE_MS);
    expect(await claim(USER_B)).toBeGreaterThan(0);

    await setClaimedAgo(USER_B, OPTIMIZER_COOLDOWN_MS + MINUTE_MS);
    expect(await claim(USER_B)).toBe(0);

    // The new claim restarts the window.
    expect(await claim(USER_B)).toBeGreaterThan(OPTIMIZER_COOLDOWN_MS - MINUTE_MS);
  });

  it("lets exactly one of eight parallel claims through", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(USER_C)));
    expect(results.filter((r) => r === 0)).toHaveLength(1);
  });

  it("lets exactly one parallel claim through on an expired slot", async () => {
    await claim(USER_D);
    await setClaimedAgo(USER_D, OPTIMIZER_COOLDOWN_MS + MINUTE_MS);
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(USER_D)));
    expect(results.filter((r) => r === 0)).toHaveLength(1);
  });

  it("keeps each user's slot separate", async () => {
    expect(await claim(USER_E)).toBe(0);
    expect(await claim(USER_F)).toBe(0);
  });

  it("raises without a session", async () => {
    await expect(
      asUser(null, (client) => client.query(`SELECT public.claim_optimizer_slot()`)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("is not executable by anon", async () => {
    await expect(
      asUser(
        USER_A,
        (client) => client.query(`SELECT public.claim_optimizer_slot()`),
        "anon",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("optimizer_runs client access (integration)", () => {
  it("a session can neither see nor change its own row", async () => {
    await claim(USER_H);

    const seen = await asUser(USER_H, (client) =>
      client.query(`SELECT * FROM public.optimizer_runs`),
    );
    expect(seen.rows).toHaveLength(0);

    const updated = await asUser(USER_H, (client) =>
      client.query(`UPDATE public.optimizer_runs SET claimed_at = now() - interval '1 year'`),
    );
    expect(updated.rowCount).toBe(0);

    const deleted = await asUser(USER_H, (client) =>
      client.query(`DELETE FROM public.optimizer_runs`),
    );
    expect(deleted.rowCount).toBe(0);

    await expect(
      asUser(USER_B, (client) =>
        client.query(
          `INSERT INTO public.optimizer_runs (user_id, claimed_at)
           VALUES ($1, now() - interval '1 year')
           ON CONFLICT (user_id) DO UPDATE SET claimed_at = EXCLUDED.claimed_at`,
          [USER_B],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    expect(await claim(USER_H)).toBeGreaterThan(0);
  });

  it("reset_all_progress leaves the slot in place", async () => {
    expect(await claim(USER_H)).toBeGreaterThan(0);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.reset_all_progress() TO authenticated`);
    await asUser(USER_H, (client) => client.query(`SELECT public.reset_all_progress()`));
    expect(await claim(USER_H)).toBeGreaterThan(0);
  });

  it("deleting the auth user removes the row", async () => {
    await pool.query(`DELETE FROM auth.users WHERE id = $1`, [USER_H]);
    const { rows } = await pool.query(
      `SELECT 1 FROM public.optimizer_runs WHERE user_id = $1`,
      [USER_H],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("migration 050 on existing rows (integration)", () => {
  it("drops the old in-progress key and leaves every other setting alone", async () => {
    const { pool: freshPool, dbName: freshDb } = await createTestDatabase();
    try {
      await applyPreMigrationFixture(freshPool);
      const dir = resolve(new URL("../../../db/migrations", import.meta.url).pathname);
      const [target] = listMigrationFiles().filter((f) => f.startsWith("050_"));
      for (const file of listMigrationFiles().filter((f) => f < target)) {
        await freshPool.query(readFileSync(resolve(dir, file), "utf8"));
      }
      await freshPool.query(`INSERT INTO auth.users (id) VALUES ($1)`, [USER_A]);
      await freshPool.query(
        `INSERT INTO public.user_settings (user_id, settings) VALUES ($1, $2)`,
        [
          USER_A,
          JSON.stringify({
            fsrsOptimizingAt: "2026-10-01T00:00:00.000Z",
            fsrsWeights: [0.4],
            fsrsWeightsOptimizedAt: "2026-10-01T00:01:00.000Z",
          }),
        ],
      );

      await freshPool.query(readFileSync(resolve(dir, target), "utf8"));

      const { rows } = await freshPool.query(
        `SELECT settings FROM public.user_settings WHERE user_id = $1`,
        [USER_A],
      );
      expect(rows[0].settings).toEqual({
        fsrsWeights: [0.4],
        fsrsWeightsOptimizedAt: "2026-10-01T00:01:00.000Z",
      });
    } finally {
      await dropTestDatabase(freshPool, freshDb);
    }
  });
});
