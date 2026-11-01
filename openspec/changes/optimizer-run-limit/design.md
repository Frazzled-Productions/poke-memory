## Root cause

The first wrong step is the route's decision to keep its limit in `user_settings.settings`
(`app/api/srs/optimize/route.ts`, the migration-free strategy in its comment). That row is a synced
preferences blob, a poor home for a limit the server enforces, and a read followed by a write leaves
a window between them. Evidence, including a read-only check of both live projects, is in ops #404
and stays there.

**Current behaviour.** The route reads `fsrsWeightsOptimizedAt` and `fsrsOptimizingAt` from settings,
stamps `fsrsOptimizingAt`, then checks the grade log and fits. The stamp is never cleared, despite the
comment, so a request refused with `not_enough_reviews` still blocks a retry for five minutes.

**Expected behaviour.** The server alone decides whether a fit may start, in one atomic step.

**Unchanged behaviour.**

- WHEN a guest calls the route THEN it SHALL CONTINUE TO return 401.
- WHEN the cloud grade log has too few fittable reviews THEN it SHALL CONTINUE TO return 422
  `not_enough_reviews` with `reviewCount`.
- WHEN a fit succeeds THEN it SHALL CONTINUE TO write `fsrsWeights` and `fsrsWeightsOptimizedAt` through
  `merge_user_settings` and return them.
- WHEN a run is refused for time THEN it SHALL CONTINUE TO return 429 `cooldown` with `retryAfterMs` and
  `Retry-After`.

**Tried before.** #393 and PR #418 added the cooldown, and a later hardening batch added the stamp to
narrow the race. Both kept the state in settings, which is the premise this change drops.

## Decisions

**One row per user, one timestamp.** `optimizer_runs (user_id PK, claimed_at)`. A log of runs is not
needed for a limit, and the FK cascade handles deletion.

**One statement claims.** `INSERT ... ON CONFLICT (user_id) DO UPDATE ... WHERE claimed_at <= now() -
window`. Postgres serialises on the row and re-checks the `WHERE` against the committed row, so one
caller wins. Parallel claims are tested on a free slot and on an expired one.

**The result is a number.** `0` means claimed; above `0` is the milliseconds left. Real PostgREST
returns a scalar `bigint` as a bare JSON number (`0`, `604800000`), so the route's `!== 0` is sound, and
anything else falls to a refusal, which a route test holds.

**Claim, with no release.** Any RPC a session can reach, a client can reach too, so a release or refund
callable by `authenticated` would undo the limit. Claiming is safe to expose because it can only spend
the caller's own slot. That is why a failed run keeps the claim, and why the cheap checks come first.

**The window lives in SQL.** It is not a parameter, for the same reason. `OPTIMIZER_COOLDOWN_MS` still
drives the Settings countdown, and an integration test holds the two together.

**The IP check fails open.** Only an explicit `false` blocks, as in `app/api/feedback`. A failed claim
fails closed with 503. The slot is the real limit, so the route loses only the bucket if that RPC
is down, and no fit runs without a slot.

**Rollout.** The migration is additive for the old route, which keeps reading settings until the new
one ships. The new route without the migration returns 503 at the claim and runs no fit.

## Risks

- A fit that dies part way spends the week. Accepted under open call 2.
- A request in cooldown still reads the grade log. Bounded by the bucket, open call 4.
- Requests with no forwarded address share one bucket. Vercel always sets it, so this only affects
  local runs, as with feedback and sign-in.
