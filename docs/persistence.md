# Adding a feature that needs to persist data

Canonical reference for choosing where new persisted data lives - a column on an existing table, a JSONB field on `user_settings`, or a brand-new table. AGENTS.md keeps a short pointer here. See also [docs/sync.md](sync.md) for the rules on pushing/pulling data.

## Tables today

Every app table, as created by `db/migrations/` (the Postgres history) and translated into `db/d1/migrations/0001_schema.sql` for Cloudflare D1. Better Auth's tables (`0002_auth.sql`) and the anonymous daily `events` counts (`0003_events.sql`) are not app tables and are not listed. There is no row-level security on D1: every per-user query goes through the scope helper (`forUser`, `lib/db/scope.ts`), and `npm run lint` fails a raw query on a per-user table outside `lib/db/`. `scripts/persistence-tables.test.mjs` fails if this list drifts from the `CREATE TABLE` / `DROP TABLE` statements in the migrations, so add a row here in the same PR as the migration. Before designing a new table, find the closest precedent below and extend its pattern rather than reinventing one.

<!-- persistence-tables:start -->
| Table | Migration | Shape and precedent |
|---|---|---|
| `card_reviews` | 001 | Per-card FSRS scheduling state; client-synced, guarded by the regression trigger (002, 015, 016, 017). |
| `streak_days` | 001 | One row per day reviewed; append-only, client-synced. |
| `user_settings` | 001 | One row per user (`user_id` is the PK); `settings` JSONB plus scalar columns such as `timezone` (019). |
| `grade_log` | 006 | Append-only per-grade event log; `UNIQUE (user_id, occurred_at)` is the cross-device dedup key. |
| `push_subscriptions` | 028 | One row per (user, browser endpoint); the client may select, insert and delete (through the data gateway), never update. Precedent for a create-or-delete, never-mutated table. Migration 049: a `NOT VALID` check on the endpoint host, and a `BEFORE INSERT` trigger that keeps an account to 10 rows. |
| `feedback` | 034 | Write-once, append-only; written only by the server-side Route Handler (`app/api/feedback`), not on the data gateway. `user_id` is **nullable** (guest feedback), and a scheduled job (`POST /api/cron/feedback-retention`) purges rows after 12 months. |
| `usernames` | 035 | Uniqueness-constraint table (`username` is the PK, `UNIQUE (user_id)`); owner-only INSERT policy (the public SELECT policy was dropped in 044). |
| `rate_limit_buckets` | 041 | Server-only internal table with **no `user_id`**: keyed on a salted `ip_hash` because callers are pre-session. Not on the data gateway; every write goes through the server's rate-limit check, and a scheduled job (`POST /api/cron/rate-limit-cleanup`) purges rows after 2 hours. |
| `feedback_discord_posts` | 051 | Server-only internal table with **no `user_id`** and no message text: maps a feedback id to its Discord bug-notification message id. No foreign key to `feedback`, so the mapping outlives the row until the code that deleted the feedback (retention job or account deletion) has deleted the Discord post (ops #405). Not on the data gateway. |
<!-- persistence-tables:end -->

**Foreign keys.** In Postgres every table with a `user_id` column referenced `auth.users(id) ON DELETE CASCADE`; on D1, account deletion (`delete_account`, `lib/db/rpc/`) deletes the user's rows from every table in one atomic `batch()`. The exceptions to "every row belongs to a user" are deliberate: `feedback.user_id` is nullable, so the cascade only applies where a user is attached (guest rows rely on the 12-month purge), and `rate_limit_buckets` has no user link at all (041 explains why a FK is inapplicable before a session exists), and neither has `feedback_discord_posts` (051: it must outlive the feedback row it points to). The new-table checklist below still requires every per-user table to be deleted with the account.

## Decide where the data lives

1. **Per-user setting / toggle / preference** → add a field to `user_settings.settings` (jsonb). No schema migration needed. Extend the `UserSettings` type in `lib/settings/persistence.ts`; the existing settings sync flow carries the new field automatically (see #307 favourite-theme for the canonical example). A list the user can shrink must be an array, not an object keyed by id: `merge_user_settings` deep-merges objects (migration 036), so a key deleted locally never leaves the cloud row, while an array is replaced whole (`heartedSpeciesIds`, #2187; proved in `lib/sync/integration/favourite-settings.test.ts`). **Exception:** if the field must not lose value to a last-write-wins race on the JSONB blob (e.g. cross-device regional prefs), add it as a scalar column on `user_settings` and write through a dedicated update path - see `timezone` / `date_format` (migration 019) for the canonical example.
2. **Per-card scheduling state** → add a column to `card_reviews` via a migration. The regression trigger (migrations 002, 015, 016, 017) guards lifecycle timestamps (`last_review`, `first_seen`), monotonic counters (`reps`, `lapses`), same-date `scheduled_days` drops, and the one-way `seen_in_pasture` flag - if your new column has its own "only moves forward" or "one-way" invariant, extend the trigger in a new migration; otherwise leave it alone.
3. **Monotonic / per-event data** (logs, daily markers, audit trails) → new table. See checklist below.

## New table checklist

A new migration `db/d1/migrations/NNNN_<snake_case_name>.sql` (SQLite, the rules in the header of `0001_schema.sql`: uuid and timestamps as TEXT, JSON as TEXT with `json_valid`, booleans as 0/1) MUST contain:

```sql
CREATE TABLE <name> (
  id      TEXT PRIMARY KEY,           -- a UUID set by the server
  user_id TEXT NOT NULL,
  -- your columns, ideally with CHECK constraints on enum-like text fields
  --   e.g. card_type TEXT NOT NULL CHECK (card_type IN ('name','evolution','reverse'))
  -- and a UNIQUE constraint that doubles as the upsert / dedup key
  --   e.g. UNIQUE (user_id, occurred_at)
) STRICT;

CREATE INDEX <name>_user_<hot_col> ON <name> (user_id, <hot_col> DESC);
```

Then, in the same PR:

- **Allowlist it** in `lib/db/tables.ts` (columns, type conversion, and which operations the data gateway allows). For append-only tables allow `select` and `insert` only; for progress-wipe flows (delete account, reset all progress) use an RPC in `lib/db/rpc/` like `reset_all_progress` instead of allowing `delete`, which keeps the destructive path centralised and auditable.
- **Delete it with the account**: add the table to `delete_account` (`lib/db/rpc/`) and, if it holds progress, to `reset_all_progress`.
- **Prove the scope**: a two-user test (`lib/db/crossUser.test.ts`) that user B can neither read nor change user A's rows.
- **Apply it locally**: `npm run db:migrate:local`.

For append-only tables (logs, daily markers, audit trails), never allow `update` or `delete` from the client - `grade_log` and `streak_days` both had theirs **removed** in Postgres migration 018 as defence against client-side wipe bugs. See "Invariants on existing data" below for the designated escape hatch.

Reference shapes: `streak_days` for an append-only monotonic table, `grade_log` for an indexed event log (both in `0001_schema.sql`).

## Invariants on existing data

If a column has a "this value only moves forward" semantic (review dates, counters, etc.) or a "one-way transition" semantic (boolean flags that should never flip back), add a `BEFORE UPDATE` trigger that aborts with `RAISE(ABORT, ...)`, which the data gateway returns as `check_violation` (`23514`, `lib/db/errors.ts`). Model: the `card_reviews` regression trigger in `0001_schema.sql`, ported from migration 002's `card_reviews_reject_regression_trigger` for lifecycle timestamps, migration 015 for monotonic counters, migration 016 for the same-date scheduling guard pattern, and migration 017 for one-way boolean flags. The client surfaces the error as a sync failure; users see "Sync failed" rather than silent data loss. Do not work around an existing trigger - a legitimate reset / delete-account flow goes through `reset_all_progress` (first migration 018, now a server-side RPC in `lib/db/rpc/`).

## Apply the migration

Apply it locally with `npm run db:migrate:local` and run the tests against it. `migration-check.yml` checks that every file in `db/d1/migrations/` applies cleanly to a fresh local D1. Production and preview databases are not migrated by hand: the deploy workflow applies pending D1 migrations before it deploys the Worker (production on push to `main`; each PR's preview Worker has its own database). Migrations therefore go live with the code that needs them, so a migration must not break the client still running in open browsers (see the two-phase rollout below).

## Wire cross-device sync

If the new table needs to follow users across devices: add `lib/sync/<feature>.ts` exporting `push`, `pull`, and a `merge` helper. Match the union-merge or last-write-wins pattern from `streak.ts` / `gradeLog.ts` / `settings.ts`. Wire the pull side into `pullAndMerge` (`lib/sync/pullAndMerge.ts`) as a best-effort leg after the existing `pullRegionalPrefs` block - wrap it in `try/catch`, `console.warn` on failure, and never flip the overall result into `"error"`. Wire the push side wherever the feature's data is written: add a handler to `AutoSyncOnChange` (`components/sync/AutoSyncOnChange.tsx`) listening for that feature's local change event, or call `push<Feature>` alongside the existing `saveX(...)` write. Add module tests in `lib/sync/<feature>.test.ts`, plus an end-to-end mock in `lib/sync/pullAndMerge.test.ts` covering the new pull leg.

## Constraint-affecting migrations (two-phase rollout)

A migration that changes a **primary key** or any **unique constraint that a client `onConflict` clause names** is backward-incompatible with the currently-deployed client, and applying the migration in the same deploy as the new client (see [Apply the migration](#apply-the-migration)) does not make it safe: the constraint flips on prod while open browsers still run the old client, and every upsert that targets the old constraint shape fails.

This is exactly what happened in #1344. Migration 029 widened the `card_reviews` PK from `(user_id, card_type, subject_key)` to `(user_id, card_type, subject_key, locale)` and was applied to prod before the matching 4-column-`onConflict` client (#1307) shipped. For ~19 hours every `card_reviews` upsert failed with `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` (SQLSTATE **42P10**) - silently, because sync is best-effort - producing the #584-shape `grade_log`-vs-`card_reviews` divergence the monitor caught days later.

**A wider PK is not a backward-compatible superset.** Postgres `ON CONFLICT (a, b, c)` requires a unique constraint on **exactly** `(a, b, c)`; widening the PK to `(a, b, c, d)` removes that constraint, so the old client breaks immediately. There is no constraint shape under which the old narrower `onConflict` keeps working against the new wider PK - and even if there were, it would arbitrate against the wrong row (an inserted `locale = 'ja'` row would collide with the existing `en` row and silently UPDATE it). Do not reach for a one-shot PK swap.

**Required process: a three-migration transitional sequence.** Any such change MUST roll out in this order - the constraining step is never applied before the matching client is live in prod:

1. **Add** a new `UNIQUE` index on the **new** column set `(a, b, c, d)` *alongside* the existing PK `(a, b, c)`. Both constraints coexist; the deployed client's `onConflict (a, b, c)` still resolves to the old PK, so nothing breaks.
2. **Ship and deploy the client** that sends the new `onConflict (a, b, c, d)`, and wait until it is actually live in production - the `qa → main` promotion plus the production Worker deploy, not merely a merge to `qa`. Only the production client matters here, because only the production client issues the upserts the constraint must accept.
3. **Only then** drop the old PK and promote the new unique index to be the primary key (a third migration).

The matching deploy-ordering rule, the full incident write-up, and the [Client-cannot-regress checklist](sync.md#client-cannot-regress-checklist) item live in [docs/sync.md - Constraint-affecting migration ordering](sync.md#constraint-affecting-migration-ordering). Surfacing 42P10 as a loud, alertable failure rather than a silent swallow is tracked separately in #1358.
