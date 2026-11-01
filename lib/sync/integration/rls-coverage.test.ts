/**
 * Integration test: Row Level Security coverage across every public table (#2212).
 *
 * rls.test.ts and usernames-rls.test.ts prove isolation on one table each. This
 * file proves two wider things:
 *   - Catalogue: every table in `public` has RLS on and at least one policy
 *     (NO_POLICY_ALLOWLIST excepted), read from pg_class, so a migration that
 *     forgets ENABLE ROW LEVEL SECURITY fails here.
 *   - Cross-user: for every table in USER_TABLES, another signed-in user cannot
 *     read, insert or update a row, and anon cannot read one.
 *
 * Every public table must appear in USER_TABLES or NO_POLICY_ALLOWLIST, so a
 * new table fails until someone states which it is.
 *
 * The fixture grants `anon` and `authenticated` what Supabase grants them on
 * both live projects (everything on every public table), so RLS is the only
 * barrier, as it is on the live database. The local `rls_auto_enable` is a
 * no-op stub, so the migrations themselves must enable RLS; the live event
 * trigger would otherwise hide the omission.
 *
 * Checks run in a rolled-back transaction, so a value read back afterwards
 * proves nothing: UPDATE cases assert on the result, inside the transaction.
 *
 * UPDATE cases name no column to read (no WHERE, and SET takes a constant).
 * Postgres also applies a table's SELECT policies to an UPDATE that reads a
 * column, so `UPDATE ... WHERE user_id = <other user>` matches nothing even
 * under an UPDATE policy of USING (true), and would hide a loose one.
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

interface UserTable {
  /** INSERT of one valid row; $1 is the user id. */
  insert: string;
  /** The table has a SELECT policy letting a user read their own row. */
  ownerReads: boolean;
  /** The table has an UPDATE policy letting a user change their own row. */
  ownerUpdates: boolean;
}

const USER_TABLES: Record<string, UserTable> = {
  card_reviews: {
    insert: `INSERT INTO public.card_reviews
               (user_id, card_type, subject_key,
                stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, fsrs_state,
                due_date, last_review, first_seen,
                seen_in_pasture, updated_at)
             VALUES ($1, 'name', '25',
                     1.0, 5.0, 0, 1,
                     1, 0, 'review',
                     '2026-06-01', '2026-05-30', '2026-05-28',
                     false, now())`,
    ownerReads: true,
    ownerUpdates: true,
  },
  feedback: {
    insert: `INSERT INTO public.feedback (user_id, category, message)
             VALUES ($1, 'bug', 'rls coverage')`,
    ownerReads: false,
    ownerUpdates: false,
  },
  grade_log: {
    insert: `INSERT INTO public.grade_log
               (user_id, occurred_at, entry_date, card_type, grade, subject_key, locale)
             VALUES ($1, 1780000000000, '2026-06-01', 'name', 4, '25', 'en')`,
    ownerReads: true,
    ownerUpdates: false,
  },
  push_subscriptions: {
    insert: `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
             VALUES ($1, 'https://push.example/rls', 'p256', 'auth')`,
    ownerReads: true,
    ownerUpdates: false,
  },
  streak_days: {
    insert: `INSERT INTO public.streak_days (user_id, review_date)
             VALUES ($1, '2026-06-01')`,
    ownerReads: true,
    ownerUpdates: false,
  },
  user_settings: {
    insert: `INSERT INTO public.user_settings (user_id) VALUES ($1)`,
    ownerReads: true,
    ownerUpdates: true,
  },
  usernames: {
    insert: `INSERT INTO public.usernames (username, user_id)
             VALUES ('user-' || left(md5($1::text), 12), $1::uuid)`,
    ownerReads: false,
    ownerUpdates: false,
  },
};

/**
 * Tables with RLS on and, by design, no policy. Migration 041: reached only
 * through a SECURITY DEFINER RPC. The exemption is from the policy rule only;
 * RLS must still be on.
 */
const NO_POLICY_ALLOWLIST = new Set(["rate_limit_buckets"]);

const USER_A = randomUUID();
const USER_B = randomUUID();

let pool: pg.Pool;
let dbName: string;

async function publicTables(db: pg.Pool | pg.PoolClient) {
  const { rows } = await db.query<{
    table_name: string;
    rls_on: boolean;
    policies: number;
  }>(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls_on,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname`,
  );
  return rows;
}

/** One line per table breaking the catalogue rule; empty when all is well. */
async function rlsGaps(db: pg.Pool | pg.PoolClient): Promise<string[]> {
  const gaps: string[] = [];
  for (const { table_name, rls_on, policies } of await publicTables(db)) {
    if (!rls_on) gaps.push(`${table_name}: RLS off`);
    else if (policies === 0 && !NO_POLICY_ALLOWLIST.has(table_name)) {
      gaps.push(`${table_name}: no policy`);
    }
  }
  return gaps;
}

/**
 * Run a callback as a Supabase role, in a transaction that always rolls back.
 * A null userId leaves auth.uid() NULL (the polyfill treats an empty sub as
 * absent), as for a request carrying only the public key.
 */
async function asRole<T>(
  role: "anon" | "authenticated",
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await withUser(client, userId ?? "", async (c) => {
      await c.query(`SET LOCAL ROLE ${role}`);
      return fn(c);
    });
  } finally {
    client.release();
  }
}

async function rowCount(
  db: pg.Pool | pg.PoolClient,
  table: string,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.${table} WHERE user_id = $1`,
    [userId],
  );
  return rows[0].n;
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  // Before the migrations, so any REVOKE they contain still wins.
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `);
  await applyMigrations(pool);

  await insertAuthUser(pool, USER_A);
  await insertAuthUser(pool, USER_B);
  // The pool is a superuser, so seeding passes RLS; triggers still run.
  for (const { insert } of Object.values(USER_TABLES)) {
    await pool.query(insert, [USER_A]);
    await pool.query(insert, [USER_B]);
  }
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("RLS catalogue (integration)", () => {
  it("every public table has RLS on and a policy, or is allowlisted", async () => {
    expect(await rlsGaps(pool)).toEqual([]);
  });

  it("every public table is classified as a user table or allowlisted", async () => {
    const tables = (await publicTables(pool)).map((t) => t.table_name);
    expect(tables).toEqual(
      [...Object.keys(USER_TABLES), ...NO_POLICY_ALLOWLIST].sort(),
    );
  });

  it("the catalogue check catches RLS off, no policy, and RLS off on an allowlisted table", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE public.rls_probe_no_policy (id int);
        ALTER TABLE public.rls_probe_no_policy ENABLE ROW LEVEL SECURITY;
        CREATE TABLE public.rls_probe_off (id int);
        ALTER TABLE public.rate_limit_buckets DISABLE ROW LEVEL SECURITY;
      `);
      expect(await rlsGaps(client)).toEqual([
        "rate_limit_buckets: RLS off",
        "rls_probe_no_policy: no policy",
        "rls_probe_off: RLS off",
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe.each(Object.entries(USER_TABLES))(
  "RLS isolation on %s (integration)",
  (table, { insert, ownerReads, ownerUpdates }) => {
    it("user A cannot SELECT user B's row", async () => {
      expect(await rowCount(pool, table, USER_B)).toBe(1);
      expect(
        await asRole("authenticated", USER_A, (c) =>
          rowCount(c, table, USER_B),
        ),
      ).toBe(0);
    });

    it(`the owner ${ownerReads ? "can" : "cannot"} SELECT their own row`, async () => {
      expect(
        await asRole("authenticated", USER_B, (c) =>
          rowCount(c, table, USER_B),
        ),
      ).toBe(ownerReads ? 1 : 0);
    });

    it("anon cannot SELECT any row", async () => {
      const { rows } = await asRole("anon", null, (c) =>
        c.query(`SELECT 1 FROM public.${table}`),
      );
      expect(rows).toHaveLength(0);
    });

    it("user A's INSERT with user_id = B is rejected by RLS", async () => {
      await expect(
        asRole("authenticated", USER_A, (c) => c.query(insert, [USER_B])),
      ).rejects.toThrow(/row-level security/);
    });

    it("user A's blind UPDATE reaches only rows user A owns", async () => {
      const result = await asRole("authenticated", USER_A, (c) =>
        c.query(`UPDATE public.${table} SET user_id = $1`, [USER_A]),
      );
      expect(result.rowCount).toBe(ownerUpdates ? 1 : 0);
    });

    it.runIf(ownerUpdates)(
      "user A cannot hand their own row to user B",
      async () => {
        await expect(
          asRole("authenticated", USER_A, (c) =>
            c.query(`UPDATE public.${table} SET user_id = $1`, [USER_B]),
          ),
        ).rejects.toThrow(/row-level security/);
      },
    );
  },
);
