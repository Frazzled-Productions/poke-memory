# Adding a feature that needs to persist data

Canonical reference for choosing where new persisted data lives - a column on an existing table, a JSONB field on `user_settings`, or a brand-new table. AGENTS.md keeps a short pointer here. See also [docs/sync.md](sync.md) for the rules on pushing/pulling data.

## Tables today

Every table in `public`, as created by `db/migrations/`. All nine have RLS enabled. `scripts/persistence-tables.test.mjs` fails if this list drifts from the `CREATE TABLE` / `DROP TABLE` statements in the migrations, so add a row here in the same PR as the migration. Before designing a new table, find the closest precedent below and extend its pattern rather than reinventing one.

<!-- persistence-tables:start -->
| Table | Migration | Shape and precedent |
|---|---|---|
| `card_reviews` | 001 | Per-card FSRS scheduling state; client-synced, guarded by the regression trigger (002, 015, 016, 017). |
| `streak_days` | 001 | One row per day reviewed; append-only, client-synced. |
| `user_settings` | 001 | One row per user (`user_id` is the PK); `settings` JSONB plus scalar columns such as `timezone` (019). |
| `grade_log` | 006 | Append-only per-grade event log; `UNIQUE (user_id, occurred_at)` is the cross-device dedup key. |
| `push_subscriptions` | 028 | One row per (user, browser endpoint); client SELECT / INSERT / DELETE policies, no UPDATE. Precedent for a create-or-delete, never-mutated table. Migration 049: a `NOT VALID` check on the endpoint host, and a `BEFORE INSERT` trigger that keeps an account to 10 rows. |
| `feedback` | 034 | Write-once, append-only; written only by the service-role Route Handler (`app/api/feedback`), no client policies. `user_id` is **nullable** (guest feedback), and a pg_cron job purges rows after 12 months. |
| `usernames` | 035 | Uniqueness-constraint table (`username` is the PK, `UNIQUE (user_id)`); owner-only INSERT policy (the public SELECT policy was dropped in 044). |
| `rate_limit_buckets` | 041 | Service-role-only internal table with **no `user_id`**: keyed on a salted `ip_hash` because callers are pre-session. No client policies; every write goes through the `check_rate_limit` SECURITY DEFINER RPC, and pg_cron purges rows after 2 hours. |
| `feedback_discord_posts` | 051 | Service-role-only internal table with **no `user_id`** and no message text: maps a feedback id to its Discord bug-notification message id. No foreign key to `feedback`, so the mapping outlives the row until the AFTER DELETE trigger has had the route delete the Discord post (ops #405). No client policies. |
<!-- persistence-tables:end -->

**Foreign keys.** Every table with a `user_id` column references `auth.users(id) ON DELETE CASCADE`, so account deletion erases the user's rows. The exceptions to "every row belongs to a user" are deliberate: `feedback.user_id` is nullable, so the cascade only applies where a user is attached (guest rows rely on the 12-month purge), and `rate_limit_buckets` has no user link at all (041 explains why a FK is inapplicable before a session exists), and neither has `feedback_discord_posts` (051: it must outlive the feedback row it points to). The new-table checklist below still requires the FK for any per-user table.

## Decide where the data lives

1. **Per-user setting / toggle / preference** → add a field to `user_settings.settings` (jsonb). No schema migration needed. Extend the `UserSettings` type in `lib/settings/persistence.ts`; the existing settings sync flow carries the new field automatically (see #307 favourite-theme for the canonical example). A list the user can shrink must be an array, not an object keyed by id: `merge_user_settings` deep-merges objects (migration 036), so a key deleted locally never leaves the cloud row, while an array is replaced whole (`heartedSpeciesIds`, #2187; proved in `lib/sync/integration/favourite-settings.test.ts`). **Exception:** if the field must not lose value to a last-write-wins race on the JSONB blob (e.g. cross-device regional prefs), add it as a scalar column on `user_settings` and write through a dedicated update path - see `timezone` / `date_format` (migration 019) for the canonical example.
2. **Per-card scheduling state** → add a column to `card_reviews` via a migration. The regression trigger (migrations 002, 015, 016, 017) guards lifecycle timestamps (`last_review`, `first_seen`), monotonic counters (`reps`, `lapses`), same-date `scheduled_days` drops, and the one-way `seen_in_pasture` flag - if your new column has its own "only moves forward" or "one-way" invariant, extend the trigger in a new migration; otherwise leave it alone.
3. **Monotonic / per-event data** (logs, daily markers, audit trails) → new table. See checklist below.

## New table checklist

A new migration `db/migrations/NNN_<snake_case_name>.sql` MUST contain:

```sql
CREATE TABLE <name> (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- your columns, ideally with CHECK constraints on enum-like text fields
  --   e.g. card_type text NOT NULL CHECK (card_type IN ('name','evolution','reverse'))
  -- and a UNIQUE constraint that doubles as the upsert / dedup key
  --   e.g. UNIQUE (user_id, occurred_at)
);

CREATE INDEX <name>_user_<hot_col> ON <name> (user_id, <hot_col> DESC);

ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<name>_select" ON <name>
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "<name>_insert" ON <name>
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE and DELETE policies are intentionally omitted for append-only tables.
-- Add them ONLY if the table is genuinely mutable from the client. For
-- progress-wipe flows (delete account, reset all progress) use a SECURITY
-- DEFINER RPC like `reset_all_progress` (migration 018) instead of opening
-- a DELETE policy, which keeps the destructive path centralised and auditable.
-- CREATE POLICY "<name>_update" ON <name>
--   FOR UPDATE USING (auth.uid() = user_id);
-- CREATE POLICY "<name>_delete" ON <name>
--   FOR DELETE USING (auth.uid() = user_id);
```

Named per-verb policies (SELECT, INSERT, and optionally UPDATE/DELETE) beat a single `FOR ALL` - easier to audit and to drop selectively. The template above defaults to SELECT + INSERT as the safe baseline for append-only tables; add UPDATE/DELETE only if the table is genuinely mutable from the client. `ON DELETE CASCADE` ensures rows die with their user. Always combine `CREATE TABLE` + `ENABLE RLS` + policies in the same migration; an enabled-RLS-without-policies state silently blocks the client.

For append-only tables (logs, daily markers, audit trails), omit the UPDATE and DELETE policies - `grade_log` and `streak_days` both had theirs **removed** in migration 018 as defence against client-side wipe bugs. See "Invariants on existing data" below for the designated escape hatch.

Reference shapes: `streak_days` (migration 001 plus the 018 lockdown) for an append-only monotonic table, `grade_log` (migration 006 plus 018) for an indexed event log.

## Invariants on existing data

If a column has a "this value only moves forward" semantic (review dates, counters, etc.) or a "one-way transition" semantic (boolean flags that should never flip back), add a `BEFORE UPDATE` trigger that `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'` (errcode `23514`). Model: migration 002's `card_reviews_reject_regression_trigger` for lifecycle timestamps, migration 015 for monotonic counters, migration 016 for the same-date scheduling guard pattern, and migration 017 for one-way boolean flags. The client surfaces the error as a sync failure; users see "Sync failed" rather than silent data loss. Do not work around an existing trigger - a legitimate reset / delete-account flow goes through `reset_all_progress` (migration 018), which is a `SECURITY DEFINER` RPC.

## Apply the migration

Migrations are new files in `db/d1/migrations/` (`NNNN_name.sql`, SQLite). Nothing is applied by hand: `deploy.yml` runs `wrangler d1 migrations apply DB` against the preview database on every PR into `qa` (before uploading that PR's preview version) and against production on every deploy from `main`, immediately before the new Worker goes live. wrangler records each applied file by name in the database's `d1_migrations` table, so a file runs once per database.

**Append-only.** Never edit, rename or delete a migration that is already on `qa`: a database that has applied it will never see the change. Put the fix in a new file. `migration-check.yml` enforces this and also applies every migration to a fresh local D1 (`wrangler d1 migrations apply DB --local`), so a migration that does not parse under D1 fails the PR. Run the whole D1 suite locally before pushing one (see [docs/testing.md](testing.md#integration-vitest--d1-on-nodesqlite)): the PR's `test` job only runs tests the import graph links to your change, and a migration is SQL read from disk.

**The old client is live for a moment.** Production applies the migration and then deploys the Worker in the same job, so the previous Worker serves requests against the new schema for the minute in between, and longer if the deploy step fails. A migration must therefore work with the client already in production; the two-phase rule below still applies.

## Wire cross-device sync

If the new table needs to follow users across devices: add `lib/sync/<feature>.ts` exporting `push`, `pull`, and a `merge` helper. Match the union-merge or last-write-wins pattern from `streak.ts` / `gradeLog.ts` / `settings.ts`. Wire the pull side into `pullAndMerge` (`lib/sync/pullAndMerge.ts`) as a best-effort leg after the existing `pullRegionalPrefs` block - wrap it in `try/catch`, `console.warn` on failure, and never flip the overall result into `"error"`. Wire the push side wherever the feature's data is written: add a handler to `AutoSyncOnChange` (`components/sync/AutoSyncOnChange.tsx`) listening for that feature's local change event, or call `push<Feature>` alongside the existing `saveX(...)` write. Add module tests in `lib/sync/<feature>.test.ts`, plus an end-to-end mock in `lib/sync/pullAndMerge.test.ts` covering the new pull leg.

## Constraint-affecting migrations (two-phase rollout)

A migration that changes a **primary key** or any **unique constraint that a client `onConflict` clause names** is backward-incompatible with the currently-deployed client, and the usual "apply the migration before merge" rule (see [Apply the migration](#apply-the-migration)) makes the hazard worse rather than better: the constraint flips on prod while the old client is still live, and every upsert that targets the old constraint shape fails.

This is exactly what happened in #1344. Migration 029 widened the `card_reviews` PK from `(user_id, card_type, subject_key)` to `(user_id, card_type, subject_key, locale)` and was applied to prod before the matching 4-column-`onConflict` client (#1307) shipped. For ~19 hours every `card_reviews` upsert failed with `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` (SQLSTATE **42P10**) - silently, because sync is best-effort - producing the #584-shape `grade_log`-vs-`card_reviews` divergence the monitor caught days later.

**A wider PK is not a backward-compatible superset.** Postgres `ON CONFLICT (a, b, c)` requires a unique constraint on **exactly** `(a, b, c)`; widening the PK to `(a, b, c, d)` removes that constraint, so the old client breaks immediately. There is no constraint shape under which the old narrower `onConflict` keeps working against the new wider PK - and even if there were, it would arbitrate against the wrong row (an inserted `locale = 'ja'` row would collide with the existing `en` row and silently UPDATE it). Do not reach for a one-shot PK swap.

**Required process: a three-migration transitional sequence.** Any such change MUST roll out in this order - the constraining step is never applied before the matching client is live in prod:

1. **Add** a new `UNIQUE` index on the **new** column set `(a, b, c, d)` *alongside* the existing PK `(a, b, c)`. Both constraints coexist; the deployed client's `onConflict (a, b, c)` still resolves to the old PK, so nothing breaks.
2. **Ship and deploy the client** that sends the new `onConflict (a, b, c, d)`, and wait until it is actually live in production - the `qa → main` promotion plus the Vercel production deploy, not merely a merge to `qa`. Only the production client matters here, because only the production client issues the upserts the constraint must accept.
3. **Only then** drop the old PK and promote the new unique index to be the primary key (a third migration).

The matching deploy-ordering rule, the full incident write-up, and the [Client-cannot-regress checklist](sync.md#client-cannot-regress-checklist) item live in [docs/sync.md - Constraint-affecting migration ordering](sync.md#constraint-affecting-migration-ordering). Surfacing 42P10 as a loud, alertable failure rather than a silent swallow is tracked separately in #1358.
