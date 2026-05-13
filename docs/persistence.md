# Adding a feature that needs to persist data

Canonical reference for choosing where new persisted data lives — a column on an existing table, a JSONB field on `user_settings`, or a brand-new table. AGENTS.md keeps a short pointer here. See also [docs/sync.md](sync.md) for the rules on pushing/pulling data.

Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`. All RLS-protected, all FK'd to `auth.users(id) ON DELETE CASCADE`. The patterns below cover the common shapes — extend rather than reinvent.

## Decide where the data lives

1. **Per-user setting / toggle / preference** → add a field to `user_settings.settings` (jsonb). No schema migration needed. Extend the `UserSettings` type in `lib/settings/persistence.ts`; the existing settings sync flow carries the new field automatically (see #307 favourite-theme for the canonical example).
2. **Per-card scheduling state** → add a column to `card_reviews` via a migration. The regression trigger from migration 002 currently guards only the lifecycle timestamps (`last_review`, `first_seen`) — if your new column has its own "only moves forward" invariant, extend the trigger; otherwise leave it alone.
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
CREATE POLICY "<name>_update" ON <name>
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "<name>_delete" ON <name>
  FOR DELETE USING (auth.uid() = user_id);
```

Four named policies (one per verb) beat a single `FOR ALL` — easier to audit and to drop selectively. `ON DELETE CASCADE` ensures rows die with their user. Always combine `CREATE TABLE` + `ENABLE RLS` + policies in the same migration; an enabled-RLS-without-policies state silently blocks the client.

Reference shapes: `streak_days` (migration 001) for an append-only monotonic table, `grade_log` (migration 006) for an indexed event log.

## Invariants on existing data

If a column has a "this value only moves forward" semantic (review dates, counters, etc.), add a `BEFORE UPDATE` trigger that `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'` (errcode `23514`). Model: migration 002's `card_reviews_reject_regression_trigger`. The client surfaces the error as a sync failure; users see "Sync failed" rather than silent data loss. Do not work around an existing trigger — a legitimate reset / delete-account flow needs a `SECURITY DEFINER` RPC plus user confirmation, not a trigger bypass.

## Apply the migration

Apply the migration to the live Supabase project **before merging** the PR that adds it — typically right after opening the PR. Call `mcp__supabase__apply_migration(name, query)` with `name` matching the filename's `<NNN>_<name>` part (drop the number and the `.sql` extension). The `migration-check.yml` workflow fails the PR's required CI check until file-vs-applied parity holds, so applying *after* merge is not an option: the PR can't merge without the migration already in place.

## Wire cross-device sync

If the new table needs to follow users across devices: add `lib/sync/<feature>.ts` exporting `push`, `pull`, and a `merge` helper. Match the union-merge or last-write-wins pattern from `streak.ts` / `gradeLog.ts` / `settings.ts`. Wire into `useManualSync` after the existing legs; failures are best-effort — `console.warn` and continue, do not flip the overall sync into the error state. Add module tests in `lib/sync/<feature>.test.ts` plus mocks in `components/sync/useManualSync.test.tsx`.
