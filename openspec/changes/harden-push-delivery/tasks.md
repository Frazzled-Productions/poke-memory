## 1. Before the build

- [x] 1.1 Fraser settles the three open calls in proposal.md. Verify: Clarifications holds his dated answers. Done: ruling 2026-11-02 on #2204, recorded in Clarifications.
- [x] 1.2 Count live rows by endpoint host on both Supabase projects (read-only, Fraser's yes first). Verify: the hosts and total are recorded in ops #380. Done: ops #380, 2 November 2026, QA 0 rows, production 2 rows on `web.push.apple.com`, none outside the list.

## 2. Delivery

- [x] 2.1 `lib/push/deliver.ts`: socket timeout, overall limit, pool of 20, 240 second budget. Verify: `lib/push/deliver.test.ts` written failing first, with "No reply", "Slow reply", "Healthy reply", "First device hangs", "Limit on sends in flight", "Payload build fails", "Budget used up" and "Budget includes the reads".
- [x] 2.2 Both routes use the helper, set `maxDuration = 300`, and lose their own loops. Verify: `route.test.tsx` in both routes, red on a first send that never settles (expected 2 calls, got 1), then green, plus "Gone", "Server error from a push service", "Reads use up the budget", the route half of "Budget used up" (dead rows deleted, 200 returned) and `expect(maxDuration).toBe(300)`.
- [x] 2.3 Prove the helper against real sockets. Verify: a local script runs `deliverPushes` against TLS servers that never reply, reply slowly and reply healthily, and the results go in ops #380. Done: ops #380, 2 November 2026 (no reply 10,014 ms, slow 15,001 ms, healthy 4 ms, 410 in `deadIds`).

## 3. Known hosts

- [x] 3.1 `lib/push/endpoints.ts`, with the check in `resubscribe` and the send path. Verify: unit tests for "Known hosts", "Lookalike endpoint" and "Row from before the check", written failing first; `resubscribe/route.test.tsx` "Unknown host".
- [ ] 3.2 Migration: `NOT VALID` check, written for both projects and applied to QA before the PR needs `migration-check` green. Verify: integration test "Unknown host" through RLS, and the parity test "One list", red on a planted difference.
- [x] 3.3 Move fixtures to an allowed host: `lib/sync/integration/push-targets-rpc.test.ts`, the send route tests (the send-time check would skip `push.example`) and `app/api/push/resubscribe/route.test.tsx` (the new check would return 400), and the fixtures of drafts #2222 and #2227 if they land first. Verify: `npm run test:integration` in CI and all three `route.test.tsx` files.

- [x] 3.4 `reconcileSubscription` returns `disabled` for a local subscription on an unknown host, with or without a row. Verify: "Unknown host in Settings", "Replaced device opens Settings", "More than 10 devices take turns" and "New subscription refused" in `components/pwa/subscribe.test.tsx` and `components/pwa/PushOptIn.test.tsx`, written failing first. Done: the reconcile tests live in `components/pwa/subscribeHelpers.test.tsx` (its existing harness), red first (`expected 'in-sync' to be 'disabled'`, `expected 're-inserted' to be 'disabled'`); the PushOptIn tests in `PushOptIn.test.tsx`; "More than 10 devices take turns" runs against the real trigger in `lib/sync/integration/push-subscription-limits.test.ts`. After review, "More than 10 devices take turns" replaces a device and then gives it its row back, and an unknown host also deletes the device's row.

## 4. Limit per account

- [x] 4.1 Trigger with an advisory lock in the same migration. Verify: integration tests "New device at the limit", "Parallel inserts", "Other users", "Account already over the limit", "Existing device re-subscribes at the limit" and "Wrong device clock", written failing first. Done: "Wrong device clock" red first (`expected [ { recent: false } ] to deeply equal [ { recent: true } ]`), green once the trigger sets `last_seen_at`; all integration exit 0, 198 passed.

## 5. Finish

- [x] 5.1 Remove the three stale cron comments in `send-daily/route.ts`, add the trigger to the `push_subscriptions` row in `docs/persistence.md`, cover the time limits, the log lines, skipped hosts and the limit of 10 in the operational notes of `docs/web-push-setup.md`, and add a `fixed` changelog fragment in this proposal's wording. Verify: `npm run lint` and the changelog lint.
- [ ] 5.2 Add the limit of 10 to the privacy notice's list of when a subscription is deleted (`app/privacy/page.tsx`), and Microsoft and the same deletion to `docs/dpia.md`. Verify: Fraser reads the wording in the PR.
- [x] 5.3 Run `/opsx:verify harden-push-delivery`, `blast-radius` and `final-review`. Verify: findings fixed or listed in the PR. Done 3 November 2026: `/opsx:verify` at the build; four reviewers (test quality, security and privacy, blast radius with a real Postgres upgrade run, OpenSpec conformance) at 2631f7cc; fixes in the follow-up commit and judged in the PR body.
