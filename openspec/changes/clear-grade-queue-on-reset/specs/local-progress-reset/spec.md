## Purpose

Local progress reset wipes a person's progress from the device: Reset all progress, Delete account,
the guest escape hatch and a reset seen from another device. This baseline records current behaviour
on `qa`, and change clear-grade-queue-on-reset adds the pending-grade queue's IndexedDB copy.
Requirements marked baseline describe the code as it stands.

## ADDED Requirements

### Requirement: A wipe clears local progress and keeps settings (baseline, current behaviour)

`clearLocalProgress` SHALL remove every `poke-memory:*` localStorage key except `poke-memory:settings:*`
and `poke-memory:user-archive:*`, and SHALL delete the review session, grade log and migration flag
from IndexedDB. It SHALL dispatch storage events for the session and grade log.

#### Scenario: Settings survive

- **WHEN** a progress reset runs with settings stored
- **THEN** `poke-memory:settings:*` keys are still there and other `poke-memory:*` keys are gone

#### Scenario: Another account's archive on a shared device

- **WHEN** a progress reset runs and `poke-memory:user-archive:<id>` exists
- **THEN** the archive is kept

#### Scenario: Same-tab screens update

- **WHEN** a progress reset finishes
- **THEN** storage events for the session and grade log are dispatched

<!-- source: lib/storage/reset.ts; lib/storage/reset.test.ts -->

### Requirement: Cloud is wiped before local (baseline, current behaviour)

For a signed-in person, `resetAllProgressEverywhere` and `deleteAccountEverywhere` SHALL call the
cloud RPC first and SHALL touch nothing local when it fails. Delete account SHALL also remove the
settings keys.

#### Scenario: Cloud call fails

- **WHEN** the RPC returns an error
- **THEN** the result is not ok and local data is unchanged

#### Scenario: Delete account removes settings

- **WHEN** the delete succeeds
- **THEN** no `poke-memory:*` localStorage key is left, including settings

<!-- source: lib/sync/reset.ts; lib/sync/deleteAccount.ts; components/settings/deleteAccount-local.test.tsx -->

### Requirement: A reset on another device wipes this one before merging (baseline, current behaviour)

When a pull sees `last_reset_at` newer than the value this device has reconciled, `pullAndMerge`
SHALL run `clearLocalProgress` before any merge.

#### Scenario: Two devices

- **WHEN** a device pulls after a reset made on another device
- **THEN** local progress is wiped before the merge runs

<!-- source: lib/sync/pullAndMerge.ts:167-186 -->

### Requirement: A wipe clears both copies of the pending-grade queue

`clearLocalProgress` SHALL delete `KEY_PENDING_GRADE_QUEUE` from IndexedDB as well as localStorage.
When the cloud RPC fails, the queue SHALL stay in both.

#### Scenario: Reset all progress while signed in

- **WHEN** grades are queued and `resetAllProgressEverywhere` succeeds
- **THEN** the queue is in neither localStorage nor IndexedDB

#### Scenario: Delete account

- **WHEN** grades are queued and `deleteAccountEverywhere` succeeds
- **THEN** the queue is in neither localStorage nor IndexedDB

#### Scenario: Reset made on another device

- **WHEN** `pullAndMerge` wipes this device after a reset elsewhere
- **THEN** the queue is in neither localStorage nor IndexedDB

#### Scenario: Offline with the cloud call failing

- **WHEN** grades are queued and the RPC fails
- **THEN** the IndexedDB queue is unchanged

#### Scenario: App closed with a sync tag still registered

- **WHEN** Background Sync fires after a wipe
- **THEN** the service worker finds an empty queue and sends nothing
