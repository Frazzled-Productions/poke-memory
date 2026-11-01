## 1. Tests

- [x] 1.1 Add `lib/sync/integration/migration-data-preservation.test.ts`, written before the runner change. Verified by: a failing run, 5 of 5, each for the predicted reason (the seed hits a column missing from the head schema, because the runner cannot stop part-way). Exit 1, in the PR body.
- [x] 1.2 Add the `{ after, through }` range to `applyMigrations`. Verified by: the new file passes 5 of 5, and the whole integration suite passes.
- [x] 1.3 Prove the tests can fail (no behaviour changes, so the failing runs come from throwaway edits, never committed). Verified by: one run per mutation with the predicted test red, and an additive migration staying green. Results in the PR body.
- [x] 1.4 Prove the documented path works: a rewrite in a new file with `SWEEP_BASELINE` moved to it. Verified by: 5 of 5 passing with a throwaway `049`.
- [x] 1.5 Check the seeds do not depend on the clock. Verified by: 5 of 5 passing under `America/Los_Angeles`, `Pacific/Kiritimati` and `Europe/London`, and no `now()` or `current_date` in the test file.

## 2. Docs

- [x] 2.1 Update `docs/testing.md` and the header of `apply-migrations.test.ts`. Verified by: `npm run lint` exit 0.

## 3. Checks

- [x] 3.1 Run the whole integration suite, the runner's unit test, `tsc --noEmit` and ESLint. Verified by: exit codes and counts in the PR body.
- [x] 3.2 Run `/opsx:verify`, `blast-radius` and the consistency pass. Verified by: result at the top of the PR body.
