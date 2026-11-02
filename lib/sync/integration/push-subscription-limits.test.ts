/**
 * Integration test: known push hosts and the per-account limit on
 * push_subscriptions (migration 049). Every insert runs as `authenticated`
 * with `auth.uid()` set.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  applyPreMigrationFixture,
  createTestDatabase,
  dropTestDatabase,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";
import { KNOWN_PUSH_ENDPOINT_PATTERN } from "@/lib/push/endpoints";

let adminPool: pg.Pool;
let dbName: string;

const HOST = "https://fcm.googleapis.com/fcm/send";

/** Runs one statement as the signed-in user, committed on success. */
async function asUser(userId: string, sql: string, params: unknown[]): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SET LOCAL ROLE authenticated");
    await client.query(sql, params);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function subscribe(userId: string, endpoint: string, lastSeen = new Date().toISOString()) {
  return asUser(
    userId,
    `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret, last_seen_at)
     VALUES ($1, $2, 'p256', 'auth', $3)`,
    [userId, endpoint, lastSeen],
  );
}

/**
 * `count` rows for a user, seeded as the admin, oldest first. The trigger sets
 * `last_seen_at` on insert, so the order is set by an UPDATE afterwards.
 */
async function seed(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await adminPool.query(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
       VALUES ($1, $2, 'p256', 'auth')`,
      [userId, `${HOST}/${i}`],
    );
    await adminPool.query(
      `UPDATE public.push_subscriptions SET last_seen_at = now() - make_interval(hours => $3)
       WHERE user_id = $1 AND endpoint = $2`,
      [userId, `${HOST}/${i}`, count - i],
    );
  }
}

async function endpoints(userId: string): Promise<string[]> {
  const { rows } = await adminPool.query<{ endpoint: string }>(
    `SELECT endpoint FROM public.push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.endpoint);
}

async function newUser(): Promise<string> {
  const id = randomUUID();
  await insertAuthUser(adminPool, id);
  return id;
}

beforeAll(async () => {
  ({ pool: adminPool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(adminPool);
  await applyMigrations(adminPool);
  await adminPool.query(`GRANT USAGE ON SCHEMA public, auth TO authenticated`);
  await adminPool.query(`GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated`);
  await adminPool.query(
    `GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated`,
  );
});

afterAll(async () => {
  await dropTestDatabase(adminPool, dbName);
});

beforeEach(async () => {
  await adminPool.query(`DELETE FROM public.push_subscriptions`);
});

describe("known push hosts", () => {
  it.each([
    "https://web.push.apple.com/a",
    "https://fcm.googleapis.com/fcm/send/a",
    "https://updates.push.services.mozilla.com/wpush/v2/a",
    "https://wns2-par02p.notify.windows.com/w/?token=a",
  ])("Known hosts: accepts %s", async (endpoint) => {
    const user = await newUser();
    await subscribe(user, endpoint);
    expect(await endpoints(user)).toEqual([endpoint]);
  });

  it.each([
    "https://push.example/a",
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.example.com/x",
    "https://fcm.googleapis.com@example.com/x",
    "https://fcm.googleapis.com:8443/x",
  ])("Unknown host: refuses %s through RLS", async (endpoint) => {
    const user = await newUser();
    await expect(subscribe(user, endpoint)).rejects.toMatchObject({ code: "23514" });
    expect(await endpoints(user)).toEqual([]);
  });

  it("Unknown host at the limit removes nothing", async () => {
    const user = await newUser();
    await seed(user, 10);
    await expect(subscribe(user, "https://push.example/a")).rejects.toMatchObject({ code: "23514" });
    expect(await endpoints(user)).toHaveLength(10);
  });

  it("keeps a row from before the check, which is NOT VALID until the follow-up", async () => {
    const user = await newUser();
    await adminPool.query(
      `ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_known_host`,
    );
    await adminPool.query(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
       VALUES ($1, 'https://push.example/old', 'p256', 'auth')`,
      [user],
    );
    await adminPool.query(
      `ALTER TABLE public.push_subscriptions
       ADD CONSTRAINT push_subscriptions_endpoint_known_host
       CHECK (endpoint ~ '${KNOWN_PUSH_ENDPOINT_PATTERN}') NOT VALID`,
    );
    expect(await endpoints(user)).toEqual(["https://push.example/old"]);
  });
});

describe("at most 10 subscriptions per account", () => {
  it("New device at the limit: the oldest row goes and the user has 10", async () => {
    const user = await newUser();
    await seed(user, 10);
    await subscribe(user, `${HOST}/new`);
    const rows = await endpoints(user);
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/new`);
    expect(rows).not.toContain(`${HOST}/0`);
  });

  it("Parallel inserts: 20 at once leave 10", async () => {
    const user = await newUser();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => subscribe(user, `${HOST}/p${i}`)),
    );
    expect(await endpoints(user)).toHaveLength(10);
  });

  it("Account already over the limit: 14 rows come down to 10, the newest among them", async () => {
    const user = await newUser();
    await seed(user, 14);
    await subscribe(user, `${HOST}/new`);
    const rows = await endpoints(user);
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/new`);
    expect(rows).toContain(`${HOST}/13`);
    expect(rows).not.toContain(`${HOST}/4`);
  });

  it("Other users: reaching the limit changes no one else's rows", async () => {
    const user = await newUser();
    const other = await newUser();
    await seed(user, 10);
    await seed(other, 3);
    await subscribe(user, `${HOST}/new`);
    expect(await endpoints(other)).toHaveLength(3);
  });

  it("Another user's id in the insert removes nothing", async () => {
    const other = await newUser();
    const caller = await newUser();
    await seed(other, 10);
    await expect(subscribe(caller, `${HOST}/x`).then(() =>
      asUser(
        caller,
        `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
         VALUES ($1, $2, 'p256', 'auth')`,
        [other, `${HOST}/y`],
      ),
    )).rejects.toMatchObject({ code: "42501" });
    expect(await endpoints(other)).toHaveLength(10);
  });

  it("Wrong device clock: the database sets last_seen_at, so the next insert does not replace it first", async () => {
    const user = await newUser();
    await seed(user, 9);
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    await subscribe(user, `${HOST}/slow-clock`, yearAgo);
    const { rows } = await adminPool.query<{ recent: boolean }>(
      `SELECT last_seen_at > now() - interval '1 minute' AS recent
       FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [user, `${HOST}/slow-clock`],
    );
    expect(rows).toEqual([{ recent: true }]);

    await subscribe(user, `${HOST}/new`);
    const after = await endpoints(user);
    expect(after).toHaveLength(10);
    expect(after).toContain(`${HOST}/slow-clock`);
    expect(after).not.toContain(`${HOST}/0`);
  });

  it("More than 10 devices take turns: the device with no row gets one back and the oldest other goes", async () => {
    const user = await newUser();
    await seed(user, 10);
    // Device 11 was replaced earlier; Settings opens on it, so reconcile re-inserts its row.
    await asUser(
      user,
      `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [user, `${HOST}/eleven`],
    );
    await subscribe(user, `${HOST}/eleven`);
    const rows = await endpoints(user);
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/eleven`);
    expect(rows).not.toContain(`${HOST}/0`);
  });

  it("Existing device re-subscribes at the limit: no other row is replaced", async () => {
    const user = await newUser();
    await seed(user, 10);
    await asUser(
      user,
      `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [user, `${HOST}/5`],
    );
    await subscribe(user, `${HOST}/5`);
    expect((await endpoints(user)).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `${HOST}/${i}`).sort(),
    );
  });
});
