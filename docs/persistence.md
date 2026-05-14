# Adding a feature that needs to persist data

Canonical reference for choosing where new persisted data lives — a column on an existing table, a JSONB field on `user_settings`, or a brand-new table. AGENTS.md keeps a short pointer here. See also [docs/sync.md](sync.md) for the rules on pushing/pulling data.

Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`. All RLS-protected, all FK'd to `auth.users(id) ON DELETE CASCADE`. The patterns below cover the common shapes — extend rather than reinvent.

## Decide where the data lives

1. **Per-user setting / toggle / preference** → add a field to `user_settings.settings` (jsonb). No schema migration needed. Extend the `UserSettings` type in `lib/settings/persistence.ts`; the existing settings sync flow carries the new field automatically (see #307 favourite-theme for the canonical example). **Exception:** if the field must not lose value to a last-write-wins race on the JSONB blob (e.g. cross-device regional prefs), add it as a scalar column on `user_settings` and write through a dedicated update path — see `timezone` / `date_format` (migration 019) for the canonical example.
2. **Per-card scheduling state** → add a column to `card_reviews` via a migration. The regression trigger (migrations 002, 015, 016, 017) guards lifecycle timestamps (`last_review`, `first_seen`), monotonic counters (`reps`, `lapses`), same-date `scheduled_days` drops, and the one-way `seen_in_pasture` flag — if your new column has its own "only moves forward" or "one-way" invariant, extend the trigger in a new migration; otherwise leave it alone.
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

Named per-verb policies (SELECT, INSERT, and optionally UPDATE/DELETE) beat a single `FOR ALL` — easier to audit and to drop selectively. The template above defaults to SELECT + INSERT as the safe baseline for append-only tables; add UPDATE/DELETE only if the table is genuinely mutable from the client. `ON DELETE CASCADE` ensures rows die with their user. Always combine `CREATE TABLE` + `ENABLE RLS` + policies in the same migration; an enabled-RLS-without-policies state silently blocks the client.

For append-only tables (logs, daily markers, audit trails), omit the UPDATE and DELETE policies — `grade_log` and `streak_days` both had theirs **removed** in migration 018 as defence against client-side wipe bugs. See "Invariants on existing data" below for the designated escape hatch.

Reference shapes: `streak_days` (migration 001 plus the 018 lockdown) for an append-only monotonic table, `grade_log` (migration 006 plus 018) for an indexed event log.

## Invariants on existing data

If a column has a "this value only moves forward" semantic (review dates, counters, etc.) or a "one-way transition" semantic (boolean flags that should never flip back), add a `BEFORE UPDATE` trigger that `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'` (errcode `23514`). Model: migration 002's `card_reviews_reject_regression_trigger` for lifecycle timestamps, migration 015 for monotonic counters, migration 016 for the same-date scheduling guard pattern, and migration 017 for one-way boolean flags. The client surfaces the error as a sync failure; users see "Sync failed" rather than silent data loss. Do not work around an existing trigger — a legitimate reset / delete-account flow goes through `reset_all_progress` (migration 018), which is a `SECURITY DEFINER` RPC.

## Apply the migration

Apply the migration to the live Supabase project **before merging** the PR that adds it — typically right after opening the PR. Call `mcp__supabase__apply_migration(name, query)` with `name` matching the filename's `<NNN>_<name>` part (drop the number and the `.sql` extension). The `migration-check.yml` workflow fails the PR's required CI check until file-vs-applied parity holds, so applying *after* merge is not an option: the PR can't merge without the migration already in place.

## Wire cross-device sync

If the new table needs to follow users across devices: add `lib/sync/<feature>.ts` exporting `push`, `pull`, and a `merge` helper. Match the union-merge or last-write-wins pattern from `streak.ts` / `gradeLog.ts` / `settings.ts`. Wire into `useManualSync` after the existing legs; failures are best-effort — `console.warn` and continue, do not flip the overall sync into the error state. Add module tests in `lib/sync/<feature>.test.ts` plus mocks in `components/sync/useManualSync.test.tsx`.
