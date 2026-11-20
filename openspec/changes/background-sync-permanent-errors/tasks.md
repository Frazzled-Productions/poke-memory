## 1. Build

- [x] 1.1 Move the handler to `lib/pwa/swReplay.ts` unchanged, with a thin listener in `app/sw.ts`. Verify: a whitespace-blind diff shows only the injected dependencies, and "scenarios through the real listener" in design.md match `qa`.
- [x] 1.2 Failing tests in `lib/pwa/swReplayHandler.test.ts`. Verify: "resolves on a 400" and "resolves on a 409" red against the moved handler with `/api/sync returned 400` and `409`; the other 13 green.
- [x] 1.3 Add the 400 and 409 branch. Verify: all 15 tests in that file green.
- [x] 1.4 Remove `simulateSwPush` from `lib/sync/swReplay.test.ts`. Verify: mutating the real 401 branch fails the new file, which it could not do to the old one.
- [x] 1.5 `docs/sync.md`, the `vitest.config.ts` comment and a `fixed` changelog fragment. Verify: `npm run lint`.
- [x] 1.6 Pin other 4xx statuses as retrying, from the final review. Verify: widening the new branch to every 4xx passed all 15 tests before this and fails the new 404, 408, 413 and 429 cases after it.

## 2. Before merge

- [ ] 2.1 Fraser settles the open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 2.2 `/opsx:verify background-sync-permanent-errors`, `blast-radius` again, `code-reviewer` (blocking for `app/sw.ts` and `lib/pwa/**`, `WORKFLOW.md`) and `final-review`. Verify: findings fixed or listed in the PR.
