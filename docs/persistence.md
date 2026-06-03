# Adding a feature that needs to persist data

Canonical reference for choosing where new persisted data lives - a column on an existing table, a JSONB field on `user_settings`, or a brand-new table. AGENTS.md keeps a short pointer here. See also [docs/sync.md](sync.md) for the rules on pushing/pulling data.

Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`. All RLS-protected, all FK'd to `auth.users(id) ON DELETE CASCADE`. The patterns below cover the common shapes - extend rather than reinvent.

## Decide where the data lives

1. **Per-user setting / toggle / preference** → add a field to `user_settings.settings` (jsonb). No schema migration needed. Extend the `UserSettings` type in `lib/settings/persistence.ts`; the existing settings sync flow carries the new field automatically (see #307 favourite-theme for the canonical example). **Exception:** if the field must not lose value to a last-write-wins race on the JSONB blob (e.g. cross-device regional prefs), add it as a scalar column on `user_settings` and write through a dedicated update path - see `timezone` / `date_format` (migration 019) for the canonical example.
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
-- a DELETE policy — that keeps the destructive path centralised and auditable.
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

Apply the migration to the live Supabase project **before merging** the PR that adds it - typically right after opening the PR. Call `mcp__supabase__apply_migration(name, query)` with `name` matching the filename's `<NNN>_<name>` part (drop the number and the `.sql` extension). The `migration-check.yml` workflow fails the PR's required CI check until file-vs-applied parity holds, so applying *after* merge is not an option: the PR can't merge without the migration already in place.

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
