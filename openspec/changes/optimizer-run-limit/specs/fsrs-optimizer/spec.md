## Purpose

The FSRS optimiser fits per-user scheduler weights from the cloud `grade_log` when a signed-in user
presses "Optimise now". This baseline records current behaviour on `qa`, and change
optimizer-run-limit adds a server-owned run limit. Requirements marked baseline describe the code as
it stands.

## ADDED Requirements

### Requirement: Only signed-in users with enough reviews get a fit (baseline, current behaviour)

`POST /api/srs/optimize` SHALL require a session. It SHALL count fittable reviews from the cloud
`grade_log`, using only cards with reviews on at least two distinct days, and SHALL refuse below
`MIN_REVIEWS_FOR_OPTIMIZATION` (200).

#### Scenario: No session

- **WHEN** a request has no valid session
- **THEN** the route returns 401 `unauthorized` and does no other work

#### Scenario: Reviews not synced yet

- **WHEN** a signed-in user's local count passes but the cloud has fewer than 200 fittable reviews
- **THEN** the route returns 422 `not_enough_reviews` with `reviewCount`, and Settings says to sync first

#### Scenario: Grade log unavailable

- **WHEN** the grade log cannot be read
- **THEN** the route returns 503 `reviews_unavailable`

<!-- source: app/api/srs/optimize/route.ts; lib/srs/optimizer.ts; app/api/srs/optimize/route.test.tsx -->

### Requirement: A successful fit is saved and returned (baseline, current behaviour)

A successful fit SHALL write `fsrsWeights` and `fsrsWeightsOptimizedAt` through `merge_user_settings`
and return `{ weights, optimizedAt, reviewCount }`. Settings SHALL apply the weights at once, without a
reload.

#### Scenario: Fit succeeds

- **WHEN** the fit returns weights and the save succeeds
- **THEN** the route returns 200, and Settings shows the new date

#### Scenario: Data the fit cannot use

- **WHEN** the native binding rejects the data
- **THEN** the route returns 422 `degenerate_data` with `reviewCount` and a truncated `detail`

<!-- source: app/api/srs/optimize/route.ts; components/settings/FsrsOptimizerSection.tsx -->

### Requirement: The Settings section follows the account's state (baseline, current behaviour)

The section SHALL show a sign-in prompt to guests, a disabled button while a superuser flag is on, a
disabled button below 200 local reviews, and a disabled countdown inside the week after
`fsrsWeightsOptimizedAt`.

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the button is disabled with its sync-paused label and no request is made

#### Scenario: Non-English locale inside the week

- **WHEN** the UI language is ja, zh-Hans or zh-Hant and the countdown shows
- **THEN** the day count uses that locale's plural form

<!-- source: components/settings/FsrsOptimizerSection.tsx; components/stats/i18n-number-plural.test.tsx; e2e/auth.spec.ts -->

### Requirement: The server owns the weekly run limit

The route SHALL start a fit only after `claim_optimizer_slot()` returns 0. A claim SHALL be recorded for
`auth.uid()` in `optimizer_runs` in one atomic statement, and SHALL be refused while the user's last
claim is under 7 days old, returning the milliseconds left. `optimizer_runs` SHALL have RLS on and no
client policies, and the RPC SHALL be executable by `authenticated` but not by `anon`. The route SHALL
NOT read `user_settings` to decide whether to run.

#### Scenario: First run

- **WHEN** a user with enough reviews and no claim presses "Optimise now"
- **THEN** the claim returns 0 and the fit runs

#### Scenario: Inside the week

- **WHEN** a user's last claim is under 7 days old
- **THEN** the route returns 429 `cooldown` with `retryAfterMs` and `Retry-After`, and does not fit

#### Scenario: Two devices at once

- **WHEN** eight requests for one user claim at the same moment, on a free or an expired slot
- **THEN** exactly one claim returns 0

#### Scenario: Settings do not decide

- **WHEN** `fsrsWeightsOptimizedAt` in settings differs from the claim, after a sync from another device
- **THEN** the claim alone decides, and Settings shows the refusal's time left

#### Scenario: Client access to the table

- **WHEN** a signed-in session selects, inserts, updates or deletes on `optimizer_runs`
- **THEN** it sees no rows and changes none

#### Scenario: No session at the RPC

- **WHEN** `claim_optimizer_slot()` is called with no user, or by `anon`
- **THEN** it raises `42501`

#### Scenario: Claim cannot be made

- **WHEN** the claim RPC errors
- **THEN** the route returns 503 `service_unavailable`, Settings says it couldn't start the optimiser,
  and no fit runs

#### Scenario: Claim gives no number

- **WHEN** the claim returns neither 0 nor a number of milliseconds
- **THEN** the route treats it as a refusal, returns 429 `cooldown` with a full week, and does not fit

#### Scenario: Reset and deletion

- **WHEN** a user calls `reset_all_progress`
- **THEN** their claim stays
- **WHEN** the account is deleted
- **THEN** the row is deleted with it

### Requirement: A request that cannot fit does not spend the slot

The route SHALL read the grade log and check the review count before it claims. A claim, once made,
SHALL stay spent whatever the fit then does.

#### Scenario: Sync first, then retry

- **WHEN** a request gets 422 `not_enough_reviews` and the user retries after syncing
- **THEN** the retry can claim at once

#### Scenario: Fit fails after the claim

- **WHEN** the fit fails or the save fails after a claim
- **THEN** the claim stands, and `save_failed` tells the user to try again next week

### Requirement: Optimiser requests are limited per IP

The route SHALL call `check_rate_limit` with action `optimize`, after the session check and before any
other work, using the salted hash of the first forwarded address. The caps SHALL be 3 in 10 minutes and
10 in an hour. A full bucket SHALL return 429 `rate_limited` with `retryAfterMs` of one hour. A failed
check SHALL be logged and SHALL NOT block the request.

#### Scenario: Many accounts on one address

- **WHEN** an address has made 3 requests in 10 minutes, on any accounts
- **THEN** the next returns 429 `rate_limited` without reading the grade log or claiming

#### Scenario: Bucket check unavailable

- **WHEN** `check_rate_limit` errors
- **THEN** the route logs a warning and continues to the claim

#### Scenario: Raw address

- **WHEN** the route checks the bucket
- **THEN** only the hash leaves the route
