## Context

The integration project runs migrations into a throwaway database on `postgres:15`. Tests connect as a superuser and drop to a role. `rls.test.ts` and `usernames-rls.test.ts` use `rls_test_user` with grants on one table each.

Live, read on 2 November 2026 from both projects: `anon` and `authenticated` hold all privileges on all 8 `public` tables, and `ensure_rls` turns RLS on for new tables.

## Decisions

- **Real roles and Supabase's grants.** The fixture runs `ALTER DEFAULT PRIVILEGES` before the migrations, then tests run as `authenticated` or `anon`. RLS is then the only barrier, as live, and any `REVOKE` in a migration still wins.
- **Blind UPDATE.** Postgres also applies a table's SELECT policies to an UPDATE that reads a column. `UPDATE ... WHERE user_id = <other>` therefore matches nothing even under `USING (true)`. The first version did this and stayed green under a loosened policy (mutations 6, 7 and 9 below). The cases now use no `WHERE` and a constant `SET`, and assert the row count.
- **Assert inside the transaction.** Every case rolls back, so reading a value afterwards proves nothing (#2219).
- **Match the RLS error.** INSERT and hand-over cases require `/row-level security/`, so a NOT NULL or CHECK failure cannot pass as isolation.
- **Control test.** One test creates bad tables in a rolled-back transaction and asserts the catalogue check reports them, so the query cannot pass by finding nothing.

## Evidence

Temporary migration `999_mutation.sql`, one at a time, removed afterwards. Each run was the three RLS files together.

| # | Mutation | Exit | Failed in `rls-coverage` | Predicted reason seen |
|---|---|---|---|---|
| 1 | New table, no RLS | 1 | 3 | `mut_no_rls: RLS off` |
| 2 | New table, RLS on, no policy | 1 | 3 | `mut_no_policy: no policy` |
| 3 | `feedback` RLS disabled | 1 | 7 | `feedback: RLS off`, then all five `feedback` cases |
| 4 | `grade_log` SELECT `USING (true)` | 1 | 2 | User A and anon read rows |
| 5 | `streak_days` INSERT `WITH CHECK (true)` | 1 | 1 | Insert passed RLS and reached the unique key |
| 6 | `card_reviews` UPDATE `USING (true)` | 1 | 2 | Blind UPDATE reached user B's row |
| 7 | `usernames` UPDATE `USING (true)` | 1 | 1 | Blind UPDATE reached user B's row |
| 9 | `user_settings` UPDATE `WITH CHECK (true)` | 1 | 1 | Hand-over passed RLS and reached the unique key |
| 10 | `rate_limit_buckets` SELECT `USING (true)` | 1 | 1 | Allowlisted table reported as having a policy |
| 11 | `feedback` INSERT `TO anon WITH CHECK (true)` | 1 | 1 | Anon's insert was not rejected |
| 12 | `card_reviews` UPDATE `TO anon USING (true)` | 1 | 1 | Anon's blind UPDATE reached rows |

Mutations 10 to 12 came from the final review, which found all three green on the first version; the cases they now fail were added then. Mutation 8 (`usernames` DELETE `USING (true)`) stayed green: DELETE is out of scope (#2219). `rls.test.ts` and `usernames-rls.test.ts` failed none of mutations 1 to 9.

## Blast radius

- **What it does, including the part that is not obvious:** adds a test. Every future `public` table now needs a line in the test or `integration` goes red.
- **The fact it is safe because of:** nothing in the app imports the test, and everything it writes stays in its own throwaway database, grants included. Rung 4 (ran it): the full integration suite exits 0 with 219 passed and 5 skipped, and the database list is empty afterwards.
- **Cleared by the final review:** spike #2205 adds a CHECK allowing only known push hosts on `push_subscriptions.endpoint` (`049_push_subscriptions_limits.sql`). The test's seed row used `push.example`, so landing #2205 would have failed this whole file in `beforeAll`. The seed now uses an FCM host, and the file stayed green under that CHECK (mutation 13).
- **Risk, confirmed:** the optimiser spike (ops #404) adds `optimizer_runs` as `db/migrations/050_optimizer_runs.sql` with no client policies. Whichever lands second must add it to `NO_POLICY_ALLOWLIST`. Likely, low cost, and the failure names the table.
- **Cleared:** the 5 skipped tests are the hand-over case on the five tables with no UPDATE policy, by design. `lib/sync/integration/**` is excluded from coverage. `ALTER DEFAULT PRIVILEGES` is per database. `postgres:15-alpine` was used locally and CI uses `postgres:15`.
- **Checked in the final review:** green on `postgres:17-alpine` (17.11), the live major version, and the first version ran in this PR's `integration` job (45 tests, 5 skipped).
