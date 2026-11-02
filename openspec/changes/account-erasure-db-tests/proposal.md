# Database tests for account erasure and reset

Fixes: poke-memory #2210

## Why

`delete_account` and `reset_all_progress` are the two paths that destroy a user's data, and neither runs against a real database in any test. Their unit tests mock the client, so they never execute SQL.

There is no defect today: all seven tables with a `user_id` column cascade from `auth.users`. The gap is the next table. `delete_account` deletes only the `auth.users` row and relies on each table's cascade, so a new table without one either keeps a deleted user's personal data or blocks the delete, and nothing fails.

## What changes

- `lib/sync/integration/account-erasure.test.ts`: seeds users A and B across all seven tables, deletes A through the real RPC, and asserts A is gone and B is untouched. Three catalogue checks fail on a bad table before any row exists: `USER_TABLES` matches the catalogue, every public `user_id` column cascades, and every foreign key to `auth.users` cascades whatever its column is called.
- `lib/sync/integration/reset-all-progress.test.ts`: the three deletes, the `last_reset_at` tombstone, the five-second cooldown, `user_settings` surviving, and the role and session refusals. Both test files also assert their RPC stays `SECURITY DEFINER` with an empty `search_path`, as the push RPC tests do.
- `lib/sync/integration/userRows.ts`: the helpers both files share.
- Docs: the new-table checklist names the test, `docs/testing.md` lists both files, three lines that said `reset_all_progress` was the only destructive path now name `delete_account` too, and the `SECURITY DEFINER` checklist in `docs/sync.md` now asks for a real-RPC integration test on a new function.

No product code, migration or schema changes, so this sets `skip_specs: true`.

## Out of scope

- Any change to either RPC or to a migration, including the comment at `027_delete_account_rpc.sql:12-15`.
- The pending-grade queue left in IndexedDB after a reset or delete (ops #400, PR on `spike/wave3-reset-idb-grade-queue`): client storage, not the database.
- Data outside Postgres, such as bug report text in Discord (ops #405).
- Per-user data the catalogue cannot see. The guard keys on a `public` column named `user_id` and on foreign keys to `auth.users`, so a table in another schema with an unlinked `user_id`, or a `public` table with an unlinked column under another name, passes (both run in review, 19 passed). No such table exists today: `public.rate_limit_buckets` is the only table without a user link, and it holds salted IP hashes from before a session exists (migration 041).
- Supabase's real `auth` schema and roles: the fixture has a minimal `auth.users`, and the RPCs run as the container's superuser rather than Supabase's `postgres` role. So cascades from Supabase's own auth tables and production-only privilege failures are not exercised; `e2e/auth-real.spec.ts` is the nearest cover.

## Also touches

- Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new: no change, because no app code changes. The Settings buttons call the same RPCs.
- Guest mode (localStorage): no change. A guest has no account to erase; a test asserts that guest feedback rows, which have a null `user_id`, survive another user's delete.
- Cloud sync and Supabase migrations (both projects): no migration, nothing to apply to either project. A future migration that adds a `user_id` table must now cascade and be added to `USER_TABLES`, or `integration-gate` (required on `qa`) goes red.
- Superuser mode and QA-seed scenarios: no change, because the tests build their own database.
- Locales: no change, because there is no UI copy.
- Push notifications and the service worker: no change. `push_subscriptions` is covered as data only.
- Sign-in: no change.
- Privacy notice and sub-processors: no change. The tests back the existing erasure promise and do not alter it.
- Accessibility: no change, because there is no UI.
- README screenshots: no change.
- Changelog fragments and the release: no fragment, the PR carries `no-changelog` because this is internal only.
- CI and GitHub Actions: no workflow change. `lib/sync/**` is already in the `integration-tests.yml` path filter, so the suite picks up both files. About 5 seconds added to that job.
- Open draft #2221 (optimiser run limit, marked must not land): its migration 050 adds `optimizer_runs` with a cascading `user_id`, an eighth table. Whichever PR lands second must add it to `USER_TABLES` and `seedUserRows`; run with that migration applied, `USER_TABLES lists every public table` is the one failure, so the gate says so.

## Removes

Nothing in code, because this only adds coverage. Three inaccurate doc statements are corrected: `reset_all_progress` as the only delete-account path (`docs/persistence.md`, `docs/sync.md`) and as the only user-session `SECURITY DEFINER` function (`docs/sync.md`).

## Owner decisions relied on

- 21 and 23 October 2026: OpenSpec for every change in every repo except `local-ai-trial` (`ops/research/openspec-trial-2026-10-21.md`).
- 23 October 2026: no-behaviour changes set `skip_specs: true` (`openspec/config.yaml`).

## Clarifications

No grilling has happened: this was built unattended overnight. Each line is an open call with a recommendation, and none blocks the tests.

- 2026-11-02: Correct the comment at `027_delete_account_rpc.sql:12-15`, which lists four of the seven tables? Recommendation: no. It is applied history, the comment was true when written, and the test header and `docs/persistence.md` now carry the current list.
- 2026-11-02: Write a baseline `account-erasure` spec now? Recommendation: no, because nothing here changes behaviour and `skip_specs: true` is the house rule. Write it when the behaviour next changes, or take it from the ops #400 change if that lands first.
- 2026-11-02: Should the catalogue check treat any foreign key to `auth.users` without a cascade as a failure, including a deliberate `SET NULL`? Recommendation: yes. A future exception then has to be argued for and allow-listed in the test.
- 2026-11-02: Keep the assertion that a reset leaves `push_subscriptions`, `feedback` and `usernames` alone? Recommendation: yes. It is today's behaviour, and any new table in `USER_TABLES` is held to it too, so adding a table to the reset becomes a conscious test edit.
- 2026-11-02: A table whose `user_id` cascades through another public table, not directly from `auth.users`, fails the guard even though its rows would be erased (run in review). Keep that strictness? Recommendation: yes. Today's seven all point straight at `auth.users`, and a direct foreign key is what `docs/persistence.md` asks for.
