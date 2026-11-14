## 1. Before the build lands

- [ ] 1.1 Fraser settles the three open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 1.2 Run `final-review` once the calls are settled, then mark the PR ready. Verify: findings judged in the PR.

## 2. Route

- [x] 2.1 Tests first. Verify: `vitest run app/api/sync/route.test.tsx` on the unfixed route, exit 1, 6 failed, 17 passed: `per-row transient failure after 23514 returns 502`, `per-row network error after 23514 returns 502`, `batch of only 23514 rejections returns 200`, `per-row structural error returns 409`, `a per-row structural error stops the remaining rows and batches`, `a per-row transient failure does not stop the next batch`.
- [x] 2.2 Real database. Verify: `lib/sync/integration/sync-route-per-row.test.ts` on `postgres:15-alpine`, unfixed route, exit 1, 3 failed, 1 passed.
- [x] 2.3 Replace `batchHadGoodRow` with `rowUnknownFailure` and the structural branch in `app/api/sync/route.ts`. Verify: route tests exit 0, 23 passed; integration file exit 0, 4 passed; `tsc --noEmit` exit 0.

- [x] 2.4 Nothing else moved. Verify: `vitest run` without the two undo-hold files, exit 0, 7449 passed; both alone, exit 0, 43 passed; `test:integration`, exit 0, 183 passed; `npm run lint`, exit 0. With all files together those two fail a different handful each run, the flake in #2190; neither touches `/api/sync`.

## 3. Docs

- [x] 3.1 `docs/sync.md` paragraph and a `fixed` changelog fragment. Verify: `npm run lint:changelog` exit 0.
