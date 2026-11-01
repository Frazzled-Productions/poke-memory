## 1. Before the build

- [ ] 1.1 Fraser settles the six open calls in proposal.md. Verify: Clarifications holds his dated answers.

## 2. Database

- [x] 2.1 Migration 050: `optimizer_runs` and `claim_optimizer_slot()`. Verify: `lib/sync/integration/optimizer-slot.test.ts` written failing first ("claims a free slot", "lets exactly one of eight parallel claims through", "uses the same window as OPTIMIZER_COOLDOWN_MS", "a session can neither see nor change its own row", "is not executable by anon", "raises without a session", "reset_all_progress leaves the slot in place", "deleting the auth user removes the row").
- [x] 2.2 `check_rate_limit` learns `optimize`, with the CHECK constraint and `RATE_LIMIT_ACTIONS`. Verify: `rate-limit.test.ts` caps and the fitness test, red with `unknown action optimize`, then green.
- [x] 2.3 Remove the in-progress key from existing rows. Verify: "drops the old in-progress key and leaves every other setting alone".
- [ ] 2.4 Apply migration 050 to QA, then production before the qa-to-main promotion. Verify: `migration-check` green. Needs Fraser's yes.

## 3. Route and UI

- [x] 3.1 Route order: session, IP bucket, grade log, count, claim, fit, save; settings read and stamp removed. Verify: `route.test.tsx`, failing first, then green: "returns 429 with Retry-After when the slot is refused", "returns 422 without claiming", "does not read user_settings to decide whether to run", "returns 429 before reading anything when the IP bucket is full", "sends the hashed first forwarded address", "carries on when the IP check errors", "returns 503 and does not fit when the slot cannot be claimed".
- [x] 3.2 `save_failed` copy. Verify: `FsrsOptimizerSection.test.tsx` "shows save-failed message".
- [x] 3.3 Prove the scalar result shape the route compares. Verify: real PostgREST 12.2.3 on local Postgres returned `0` and `604800000` as bare JSON numbers.

## 4. Finish

- [x] 4.1 `docs/persistence.md`, `AGENTS.md` table list, `docs/srs.md`, a `changed` changelog fragment. Verify: `scripts/persistence-tables.test.mjs` and `npm run lint`.
- [ ] 4.2 Run `/opsx:verify optimizer-run-limit`, `blast-radius` and `final-review` on the real build. Verify: findings fixed or listed in the PR.
