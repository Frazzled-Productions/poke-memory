## ADDED Requirements

### Requirement: Cloud reads and writes go through the data gateway

Every sync leg in the browser (cards, settings, streak, grade log, regional prefs, push count, reset,
delete) SHALL use the data client from `lib/db/client.ts`, which sends each query to `POST /api/db`
with the same query shapes the sync code sent to Supabase. The unload beacon and the Background Sync
replay SHALL keep `POST /api/sync`. The sync rules in this capability SHALL stay as they are: results,
error codes and structural-error handling reach the sync code unchanged.

#### Scenario: Parity with the old client

- **WHEN** `pullSession`, `pushSession`, `pushSingleCard`, the settings, streak and grade-log legs run against the D1 test database
- **THEN** they return what they returned against Postgres, including `"rejected"` for a `23514`

#### Scenario: Offline

- **WHEN** a pull runs with no connection
- **THEN** the client returns an error, `pullAndMerge` returns `"error"` and local state is unchanged

#### Scenario: Guest

- **WHEN** no user is signed in
- **THEN** no request reaches the gateway

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on during a sign-in pull
- **THEN** reads go through the gateway and no write is sent

#### Scenario: Two devices syncing

- **WHEN** a phone pushes a grade and a laptop pulls afterwards
- **THEN** the laptop merges the phone's row by the per-card merge rule, as before

Source (planned): design D5, `lib/db/client.ts`, `lib/sync/**`.

### Requirement: The settings merge runs in the Worker and keeps nulls

`merge_user_settings` SHALL run in the Worker: read the row, deep-merge the patch into the blob, set
`updated_at`, and write with a compare-and-swap on `updated_at`, retrying up to 5 times. A key whose
patch value is null SHALL be kept as null, as Postgres `jsonb_deep_merge` did, not dropped as SQLite's
`json_patch` would. The user id SHALL come from the session only.

#### Scenario: Null in a patch

- **WHEN** a patch sets a nested key to null
- **THEN** the stored blob holds that key with a null value

#### Scenario: Two devices push at once

- **WHEN** two devices patch different keys at the same moment
- **THEN** both patches land, the second after a retry

#### Scenario: Retries used up

- **WHEN** the compare-and-swap loses 5 times
- **THEN** the RPC returns an error, `pushSettings` returns false and the next save resends the keys

#### Scenario: No row yet

- **WHEN** a signed-in player with no `user_settings` row pushes a patch
- **THEN** a row is created holding the patch

Source (planned): design D3, `lib/db/rpc/mergeUserSettings.ts`; tests ported from the Postgres RPC
integration tests (task 3.3).

## RENAMED Requirements

- FROM: `### Requirement: The database refuses settings that lose data (baseline)`
- TO: `### Requirement: The settings merge refuses settings that lose data`

## MODIFIED Requirements

### Requirement: The settings merge refuses settings that lose data

The Worker's settings merge SHALL refuse, with code 23514 and no write, a patch whose result removes a
streak spend date, drops the balance with no new spend, removes a badge, turns off a one-way onboarding
flag or lowers an onboarding counter (both unless `onboardingResetAt` advanced), turns off
`typedEntryOnboardingShown` or `mcCardOnboardingShown` (never bypassed), or removes a learning locale not
in `removedLocales`. These are the rules of Postgres migration 038.

#### Scenario: Stale device drops a badge

- **WHEN** an update's `earnedBadges` lacks a badge id the row holds
- **THEN** the update fails with 23514 and `pushSettings` returns false

#### Scenario: Locale removed with a tombstone

- **WHEN** a patch removes `ja` from `learningLocales` and adds it to `removedLocales`
- **THEN** the merge accepts it

#### Scenario: Onboarding reset on another device

- **WHEN** a patch turns off `statsHintDismissed` with a newer `onboardingResetAt`
- **THEN** the merge accepts it

Source (planned): `lib/db/rpc/mergeUserSettings.ts`; rules from
`db/migrations/038_user_settings_reject_regression_trigger.sql`.

### Requirement: Sync route (baseline)

`POST /api/sync` SHALL check the body before auth: invalid JSON or non-array `cards` answers 400. No
session answers 401. An empty `cards` array answers 200 with no card write. Rows SHALL go through the
scope helper with `user_id` from the session, `locale` defaulting to `"en"`, no `updated_at`, and no
`seen_in_pasture` when absent or null. Cards SHALL go in batches of 200, each one D1 batch tried up to 3
times 100 ms apart. Per-row reporting after the fallback is wrong today (#2206).

#### Scenario: Not signed in

- **WHEN** a valid body arrives with no session
- **THEN** the route answers 401 and writes nothing

#### Scenario: One transient failure

- **WHEN** the first batch fails with a generic error and the second try succeeds
- **THEN** the route answers 200

#### Scenario: Schema mismatch

- **WHEN** a batch fails with a class 42 code, such as `42703`
- **THEN** no retry runs and the route answers 409 `structural_error` with that code

#### Scenario: Regression trigger rejects a batch

- **WHEN** a batch fails with 23514
- **THEN** its rows are upserted one by one and 23514 rows are skipped

#### Scenario: A batch lands nothing

- **WHEN** a batch runs out of retries, or no row lands after the fallback
- **THEN** the route answers 502 `partial_failure`

#### Scenario: Non-object entry in cards

- **WHEN** an entry in `cards` is null
- **THEN** the route throws and answers an unhandled 500, because row shapes are not validated (#2232)

#### Scenario: Body is JSON null

- **WHEN** the body is the JSON value `null`
- **THEN** the route throws reading `cards`, before any 400 check, and answers an unhandled 500

#### Scenario: All batches land

- **WHEN** every batch is written
- **THEN** the route answers 200

Source (planned): `app/api/sync/route.ts`, `lib/db/scope.ts`; tests `app/api/sync/route.test.tsx`.

### Requirement: Database guards on card rows (baseline)

`card_reviews` SHALL be keyed by `(user_id, card_type, subject_key, locale)`, the column list every
upsert uses. A D1 trigger SHALL abort an update with 23514 when `last_review` or `first_seen` becomes
null, `last_review` moves back, `reps` or `lapses` fall, `scheduled_days` falls on the same
`last_review`, or `seen_in_pasture` goes from true to false. A second trigger SHALL set `updated_at` to
server time on every update. The scope helper SHALL limit each query to its own user.

#### Scenario: A stale device writes lower reps

- **WHEN** an update has `reps` below the stored value
- **THEN** it fails with 23514 and the row is unchanged

#### Scenario: Client sends no timestamp

- **WHEN** a push updates a row
- **THEN** `updated_at` is the server's time

#### Scenario: Two users with the same card

- **WHEN** users A and B both push the same card key
- **THEN** each has their own row and neither push touches the other's

Source (planned): `db/d1/migrations/0001_schema.sql`, `lib/db/scope.ts`, `lib/sync/cloud.ts:41`; the
D1 port of `lib/sync/integration/regression-trigger.test.ts` and `onconflict-pk-parity.test.ts`.

### Requirement: CHECK constraints share the regression code (baseline)

D1 CHECK constraints SHALL bound `locale`, `fsrs_state`, `stability` and `difficulty` on `card_reviews`.
A CHECK failure SHALL reach callers as 23514, as the triggers do, so clients and the route treat such a
row as if the cloud row were newer.

#### Scenario: A row breaks a CHECK constraint

- **WHEN** `pushSingleCard` sends a `difficulty` above 10
- **THEN** it returns `"rejected"` and the card leaves the queue

Source (planned): `db/d1/migrations/0001_schema.sql`, `lib/db/errors.ts`, `lib/sync/cloud.ts:336`.

### Requirement: Resetting progress (baseline)

`reset_all_progress` SHALL run in the Worker as one atomic D1 batch for the session user: refuse a
repeat within 5 seconds, delete the user's `card_reviews`, `grade_log` and `streak_days` rows, and
stamp `last_reset_at` and `updated_at`, keeping the settings. `resetAllProgressEverywhere` SHALL clear
local only after it succeeds. A pull seeing a newer `last_reset_at` (or a null cursor) SHALL clear
local before merging. Two scenarios look like bugs (#2231, #2334).

#### Scenario: Cloud reset fails

- **WHEN** the RPC errors
- **THEN** local stays intact and the result is `cloud-reset-failed`

#### Scenario: Reset on another device

- **WHEN** a pull sees a newer `last_reset_at`
- **THEN** local progress is cleared before the merge and the new value is stored as `lastSeenResetAt`

#### Scenario: Reset on this device, then a pull

- **WHEN** this device reset, then a later pull runs
- **THEN** local progress is cleared a second time, because the local clear also removed `lastSeenResetAt`

#### Scenario: Stale row after a reset

- **WHEN** a row is inserted dated before the UTC date of `last_reset_at`
- **THEN** the D1 INSERT trigger aborts it with 23514

#### Scenario: Queued rows at a reset

- **WHEN** local is cleared, on this device or after a reset on another device, with rows in the pending-queue mirror
- **THEN** the mirror is removed from IndexedDB with the localStorage copy, so the service worker has nothing to replay

#### Scenario: Cloud reset fails with rows queued

- **WHEN** the RPC errors with rows in the pending queue
- **THEN** the queue stays in both localStorage and IndexedDB

#### Scenario: Stale row dated the reset day

- **WHEN** a row is inserted dated the same UTC day as `last_reset_at`
- **THEN** the trigger lets it in, even if it was graded before the reset

#### Scenario: Settings row cannot be read

- **WHEN** a pull's settings read fails after a reset elsewhere
- **THEN** local is not cleared on this pull, the merge continues, and the next pull clears it

#### Scenario: Batch fails halfway

- **WHEN** one statement of the reset batch fails
- **THEN** no row is deleted and `last_reset_at` is unchanged

Source (planned): `lib/db/rpc/resetAllProgress.ts`, `db/d1/migrations/0001_schema.sql`,
`lib/sync/reset.ts:50`, `lib/sync/pullAndMerge.ts:174`, `lib/sync/pullAndMerge.ts:624`,
`lib/storage/reset.ts:22`, `lib/storage/reset.ts:53-58`, `lib/sync/pullAndMerge.test.ts:741`.

### Requirement: Deleting an account (baseline)

`deleteAccountEverywhere` SHALL call `delete_account` first; on success it SHALL clear local progress
and sweep every `poke-memory:*` key, settings included. The Worker SHALL delete the user's rows in every
table, and the account itself, in one atomic D1 batch.

#### Scenario: Delete fails

- **WHEN** the RPC errors
- **THEN** local data stays and the result is `cloud-delete-failed`

#### Scenario: Delete succeeds

- **WHEN** the RPC succeeds
- **THEN** no cloud row of that user remains and local progress is cleared

Source (planned): `lib/sync/deleteAccount.ts:41`, `lib/sync/deleteAccount.ts:77`,
`lib/db/rpc/deleteAccount.ts`; tests `lib/sync/deleteAccount.test.ts`.
