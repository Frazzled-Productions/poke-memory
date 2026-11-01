## 1. Tests

- [x] 1.1 Add `lib/sync/integration/userRows.ts`: `USER_TABLES`, the seed, the row reader and an RPC caller that runs as a non-superuser role. Verified by: the two test files below use it, `tsc --noEmit` exit 0.
- [x] 1.2 Add `lib/sync/integration/account-erasure.test.ts`: users A and B across all seven tables, A gone, B untouched, and the catalogue checks on every `user_id` column and every foreign key to `auth.users`. Verified by: the file passes, and each mutation in 1.4 fails it in the predicted test.
- [x] 1.3 Add `lib/sync/integration/reset-all-progress.test.ts`: the three deletes, the tombstone, the cooldown, `user_settings` surviving. Verified by: the file passes, and each mutation in 1.4 fails it in the predicted test.
- [x] 1.4 Prove the tests can fail (no behaviour changes, so the failing run comes from throwaway migrations, never committed). Verified by: one run per mutation, predicted failures matching, results in the PR body.

## 2. Docs

- [x] 2.1 Update `docs/testing.md` and the new-table checklist in `docs/persistence.md`, and correct the lines in `docs/persistence.md` and `docs/sync.md` that named `reset_all_progress` as the only path. Verified by: `npm run lint` exit 0.

## 3. Checks

- [x] 3.1 Run the whole integration suite and the unit suite. Verified by: exit codes and counts in the PR body.
- [x] 3.2 Run `/opsx:verify` and the consistency pass. Verified by: result at the top of the PR body.
