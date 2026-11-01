## 1. Before the build

- [ ] 1.1 Fraser settles the four open calls in proposal.md. Verify: Clarifications holds his dated answers.
- [ ] 1.2 Count live rows by endpoint host on both Supabase projects (read-only, Fraser's yes first). Verify: the hosts and total are recorded in ops #380, not in this public repo.

## 2. Delivery

- [ ] 2.1 `lib/push/deliver.ts`: socket timeout, overall limit, pool of 20, 240 second budget. Verify: `lib/push/deliver.test.ts` written failing first, with "No reply", "Slow reply", "Healthy reply", "First device hangs", "Limit on sends in flight" and "Budget used up".
- [ ] 2.2 Both routes use the helper, set `maxDuration = 300`, and lose their own loops. Verify: `route.test.tsx` in both routes, red on a first send that never settles (expected 2 calls, got 1), then green, plus "Gone" and "Server error from a push service".
- [ ] 2.3 Prove the helper against real sockets. Verify: the local TLS script from design.md re-run through `deliverPushes`, all four servers.

## 3. Known hosts

- [ ] 3.1 `lib/push/endpoints.ts`, with the check in `resubscribe` and the send path. Verify: unit tests for "Known hosts", "Lookalike endpoint" and "Row from before the check", written failing first; `resubscribe/route.test.tsx` "Unknown host".
- [ ] 3.2 Migration: `NOT VALID` check, written for both projects. Verify: integration test "Unknown host" through RLS, and the parity test "One list", red on a planted difference.
- [ ] 3.3 Move fixtures to an allowed host: `lib/sync/integration/push-targets-rpc.test.ts`, the send route tests (the send-time check would skip `push.example`), and `e2e/settings.spec.ts` if its insert reaches the database. Verify: `npm run test:integration` in CI, both `route.test.tsx` files and the settings e2e.

## 4. Limit per account

- [ ] 4.1 Trigger with an advisory lock in the same migration. Verify: integration tests "New device at the limit", "Parallel inserts", "Other users" and "Existing device re-subscribes at the limit", written failing first.

## 5. Finish

- [ ] 5.1 Remove the stale cron comment and add a `fixed` changelog fragment in this proposal's wording. Verify: `npm run lint` and the changelog lint.
- [ ] 5.2 Run `/opsx:verify harden-push-delivery`, `blast-radius` and `final-review`. Verify: findings fixed or listed in the PR.
