## 1. Spec on touch

- [x] 1.1 Write the baseline for `row-level-security` from `db/migrations/` and confirm it against both live projects. Verified by a read-only catalogue query (2 November 2026, both exit 0): 8 tables, RLS on all, 17 policies, no views.

## 2. Build

- [x] 2.1 Add the catalogue checks and control test to `lib/sync/integration/rls-coverage.test.ts`. Verified by the "RLS catalogue" tests: red under mutations 1, 2 and 3 for the predicted reason (design.md).
- [x] 2.2 Add the cross-user SELECT, INSERT, UPDATE and anon cases over the seven user tables. Verified by the "RLS isolation" tests: red under mutations 3 to 7 and 9 (design.md), green on `qa`: 40 passed, 5 skipped, exit 0.
- [x] 2.3 Name the test in `docs/testing.md` and `docs/persistence.md`. Verified by `npm run lint`.
- [x] 2.4 Run the full integration suite. Verified: 19 files, 219 passed, 5 skipped, exit 0.

## 3. Follow-ups

- [x] 3.1 ~~Fix the three tests that cannot fail and add cross-user DELETE~~ Moved to #2219 (2026-11-02)
