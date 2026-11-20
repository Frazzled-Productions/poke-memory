## MODIFIED Requirements

### Requirement: Resetting progress (baseline)

`reset_all_progress` SHALL require a session, refuse a repeat within 5 seconds, delete the user's
`card_reviews`, `grade_log` and `streak_days` rows, and stamp `last_reset_at` and `updated_at`, keeping
the settings blob. `resetAllProgressEverywhere` SHALL do this first and clear local only on success. A
pull seeing `last_reset_at` later than `lastSeenResetAt`, or with that cursor null, SHALL clear local
before merging.

Two scenarios below look like bugs (#2231, #2334).

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
- **THEN** the INSERT trigger raises 23514

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

Source: `db/migrations/026_reset_all_progress_cooldown.sql:28`, `db/migrations/026_reset_all_progress_cooldown.sql:45`, `db/migrations/026_reset_all_progress_cooldown.sql:54`, `db/migrations/022_user_settings_last_reset_at_tombstone_triggers.sql:25`, `db/migrations/022_user_settings_last_reset_at_tombstone_triggers.sql:68`, `db/migrations/022_user_settings_last_reset_at_tombstone_triggers.sql:133`, `lib/sync/reset.ts:50`, `lib/sync/pullAndMerge.ts:174`, `lib/sync/pullAndMerge.ts:624`, `lib/storage/reset.ts:22`, `lib/storage/reset.ts:53-58`, `lib/sync/pullAndMerge.test.ts:741`.
