/**
 * Helpers for the account-erasure and reset-all-progress integration tests:
 * seed one user across every table that holds per-user rows, read those rows
 * back, and call an RPC the way PostgREST does (as a non-superuser role with
 * JWT claims set, committing on success).
 */

import pg from "pg";

/**
 * Every public table with a `user_id` column. account-erasure.test.ts fails if
 * this drifts from the catalogue, so a new per-user table has to be added here
 * and to `seedUserRows`, which puts it under the erasure tests.
 */
export const USER_TABLES = [
  "card_reviews",
  "feedback",
  "grade_log",
  "push_subscriptions",
  "streak_days",
  "user_settings",
  "usernames",
] as const;

export type UserTable = (typeof USER_TABLES)[number];

/** The tables `reset_all_progress` empties for the caller. */
export const PROGRESS_TABLES = [
  "card_reviews",
  "grade_log",
  "streak_days",
] as const satisfies readonly UserTable[];

/** Inserts one row of progress data, dated today so a reset tombstone accepts it. */
export async function seedProgressRows(
  pool: pg.Pool,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO card_reviews
       (user_id, card_type, subject_key,
        stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, fsrs_state,
        due_date, last_review, first_seen,
        seen_in_pasture, updated_at)
     VALUES ($1, 'name', '25',
             1.0, 5.0, 0, 1,
             1, 0, 'review',
             CURRENT_DATE + 1, CURRENT_DATE, CURRENT_DATE,
             false, now())`,
    [userId],
  );
  await pool.query(
    `INSERT INTO grade_log
       (user_id, occurred_at, entry_date, card_type, subject_key, locale, grade)
     VALUES ($1, 1, CURRENT_DATE, 'name', '25', 'en', 4)`,
    [userId],
  );
  await pool.query(
    `INSERT INTO streak_days (user_id, review_date) VALUES ($1, CURRENT_DATE)`,
    [userId],
  );
}

/** Inserts at least one row into every table in `USER_TABLES` for `userId`. */
export async function seedUserRows(
  pool: pg.Pool,
  userId: string,
): Promise<void> {
  await seedProgressRows(pool, userId);
  await pool.query(
    `INSERT INTO user_settings (user_id, settings)
     VALUES ($1, '{"favouriteTheme": "kanto"}')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret)
     VALUES ($1, $2, 'p256dh', 'auth-secret')`,
    [userId, `https://fcm.googleapis.com/fcm/send/${userId}`],
  );
  // 'feature', not 'bug': the bug path has a notification trigger (migration 042).
  await pool.query(
    `INSERT INTO feedback (user_id, category, message)
     VALUES ($1, 'feature', 'personal words')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO public.usernames (username, user_id) VALUES ($1, $2)`,
    [`u-${userId.slice(0, 8)}`, userId],
  );
}

/** Every row `userId` owns, per table, in a stable order for comparison. */
export async function readUserRows(
  pool: pg.Pool,
  userId: string,
): Promise<Record<UserTable, unknown[]>> {
  const entries = await Promise.all(
    USER_TABLES.map(async (table) => {
      const { rows } = await pool.query(
        `SELECT to_jsonb(t) AS row
         FROM public.${table} t
         WHERE user_id = $1
         ORDER BY to_jsonb(t)::text`,
        [userId],
      );
      return [table, rows.map((r) => r.row)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<UserTable, unknown[]>;
}

/**
 * Calls a no-argument RPC as `role` and commits, as PostgREST would. A null
 * `userId` is a session whose JWT has no subject, so `auth.uid()` is NULL.
 */
export async function callRpcAs(
  pool: pg.Pool,
  rpc: "delete_account" | "reset_all_progress",
  role: "authenticated" | "anon",
  userId: string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      claims,
    ]);
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT public.${rpc}()`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The hardening `docs/sync.md` requires of a user-session RPC: SECURITY DEFINER
 * with an empty search_path. A `CREATE OR REPLACE` that drops either clause
 * still passes every behavioural test while the superuser owns the function.
 */
export async function rpcHardening(
  pool: pg.Pool,
  rpc: "delete_account" | "reset_all_progress",
): Promise<{ securityDefiner: boolean; searchPath: string | undefined }> {
  const { rows } = await pool.query(
    `SELECT prosecdef, proconfig
     FROM pg_proc
     WHERE oid = to_regprocedure($1)`,
    [`public.${rpc}()`],
  );
  const config: string[] = rows[0].proconfig ?? [];
  return {
    securityDefiner: rows[0].prosecdef,
    searchPath: config
      .find((c) => c.startsWith("search_path="))
      ?.replace(/"/g, ""),
  };
}
