# Test that migrations keep their rows

Fixes: poke-memory #2217

## Why

`apply-migrations.test.ts` only proves every file applies to an empty schema. The fixture seeds an `auth.users` row and nothing else, so data-rewriting migrations ran on empty tables in CI, and a future migration that loses or rewrites rows passes every check. #2158 is a different check: it reads what a migration's SQL says, not what happens to rows. It is related work and is not merged with this.

## What changes

- `lib/sync/integration/migration-data-preservation.test.ts`, five tests:
  - 004, 009, 010 and 012: SM-2 `card_reviews` rows seeded after 003 reach the head schema with the right FSRS state and string keys, and the two legacy-range ends are deleted.
  - 005: `user_settings` and `streak_days` rows survive everything after 003.
  - 013: `grade_log` keeps the five rows it can rekey and drops the five it cannot.
  - 012: an evolution row that 010 left unkeyed stops the migration, and the row keeps its data.
  - The sweep: rows in all eight public tables at `SWEEP_BASELINE` (041, the last migration to add a table) pass through every later file unchanged. This is the guard for future migrations; a new file is covered with no edit here, and the sweep already runs over 042 to 048.
- `lib/sync/integration/applyMigrations.ts`: `applyMigrations(pool, { after, through })`, so a test can stop part-way. An unknown filename throws, so a renamed file cannot widen the range. With no range it applies every file as before.
- `docs/testing.md`: what the test is and what to do when the sweep fails. `apply-migrations.test.ts`: its header points at the new file.

No product code, migration or schema changes, so this sets `skip_specs: true`.

## Out of scope

- Any change to a migration, including the behaviour the 012 test pins.
- The destructive-SQL rule in #2158.
- Data outside the seeded rows. The sweep sees what it seeds, so a rewrite limited to, say, `locale = 'zh-Hans'` would pass.
- Anything `pg_cron` runs. The `postgres:15` container has no `pg_cron`, so scheduled deletes (such as the feedback retention purge) and any SQL behind a "skip if unavailable" exception block do not run here.
- The real `auth.users`: the fixture table is minimal.

## Also touches

Checked with `blast-radius`. The one fact this is safe because of: `applyMigrations.ts` is test-only (outside `lib/sync/integration/`, only `lib/sync/applyMigrations.test.ts` imports it), and with no range it behaves as before. Proven by running: the whole integration suite, including the 18 older test files that call it, passes.

- Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new: no change, because no app code changes.
- Guest mode (localStorage): no change, because guests have no cloud rows.
- Cloud sync and Supabase migrations (both projects): no migration, nothing to apply to either project. A future migration that rewrites a seeded row now fails `integration-gate` (required on `qa`) until its author adds a named test and moves the baseline, and updates the expected values of any older named test the rewrite reaches, since those also run to the head. That is the point of the change.
- Superuser mode and QA-seed scenarios: no change, because the tests build their own databases.
- Locales: no change, because there is no UI copy.
- Push notifications and the service worker: no change. `push_subscriptions` is covered as data only.
- Sign-in: no change.
- Privacy notice and sub-processors: no change, and the seeds are invented values.
- Accessibility: no change, because there is no UI.
- README screenshots: no change.
- Changelog fragments and the release: no fragment, the PR carries `no-changelog` because this is internal only.
- CI and GitHub Actions: no workflow change. `lib/sync/**` and `db/migrations/**` are already in the `integration-tests.yml` path filter, so a new migration runs the sweep. About 4 seconds added to that job.

## Removes

Nothing, because this only adds coverage. It simplifies nothing in the runner and leaves `apply-migrations.test.ts` in place, as that still proves files apply to an empty schema.

## Owner decisions relied on

- 21 and 23 October 2026: OpenSpec for every change in every repo except `local-ai-trial` (`ops/research/openspec-trial-2026-10-21.md`).
- 23 October 2026: no-behaviour changes set `skip_specs: true` (`openspec/config.yaml`).

## Clarifications

No grilling has happened: this was built unattended overnight. Each line is an open call with a recommendation, and none blocks the tests.

- 2026-11-02: Should the sweep count as a behaviour change, because it can newly fail a required check, and so carry a spec delta? Recommendation: no. It follows the same precedent as the account-erasure tests (`integration-gate` goes red on a bad table, `skip_specs: true`), and no shipped behaviour moves.
- 2026-11-02: Keep the 012 test, given production's unkeyed rows were repaired by hand (#465) and 012 cannot run again? Recommendation: yes. It is the only test showing a file is all-or-nothing under the runner, which is what makes a failed rewrite safe. It also records that replaying history against a pre-#465 copy of the data would stop at 012.
- 2026-11-02: Pin the baseline at 041 or at the newest file? Recommendation: 041. It is the last migration to add a table and gives the sweep real work today (042 to 048). At the newest file it would run nothing until 049 exists.
- 2026-11-02: Should tables added after 041 join the sweep automatically? Recommendation: no. Their first rewrite moves the baseline and extends `SWEEP_SEED`. A guard that a new table has a seed would need the seed to be written against the head schema, which breaks the "never run later" property that keeps the seed valid.
- 2026-11-02: Share a seed with the `userRows.ts` helper on `spike/wave3-account-erasure-db-tests`? Recommendation: no. That helper tracks the head schema and this seed is pinned to 041, so sharing would break one or the other.
