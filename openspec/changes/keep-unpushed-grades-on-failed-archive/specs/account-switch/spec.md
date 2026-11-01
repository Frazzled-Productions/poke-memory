## Purpose

What happens to local data when a different account signs in on a device: the outgoing user's state is
archived and wiped, and the incoming user's is restored. This baseline records current behaviour on
`qa`, and change keep-unpushed-grades-on-failed-archive adds what happens when the archive fails.
Requirements marked baseline describe the code as it stands.

## ADDED Requirements

### Requirement: The guard acts only on a different user (baseline, current behaviour)

`guardAccountSwitch` SHALL do nothing when the device has no owner or when the incoming user already
owns it. It SHALL finish before `pullAndMerge` starts.

#### Scenario: Guest signs in

- **WHEN** `ownerUserId` is null
- **THEN** nothing is archived, wiped or restored

#### Scenario: Same user signs in again

- **WHEN** `ownerUserId` equals the incoming user
- **THEN** nothing is archived, wiped or restored

<!-- source: lib/sync/guardAccountSwitch.ts; lib/sync/guardAccountSwitch.test.ts -->

### Requirement: A switch archives, wipes and restores in order (baseline, current behaviour)

For a different user, the guard SHALL archive the outgoing user, delete the IndexedDB queue, session
and grade log, wipe per-user localStorage keys including settings, then restore the incoming user. It
SHALL keep device-level keys and every archive.

#### Scenario: Offline grades must not replay as the wrong user

- **WHEN** a switch runs with queued grades
- **THEN** the IndexedDB queue is deleted before the localStorage wipe

#### Scenario: Device-level keys

- **WHEN** a switch runs with superuser flags stored
- **THEN** those flags are still there and per-user keys are gone

<!-- source: lib/sync/guardAccountSwitch.ts; lib/sync/guardAccountSwitch.test.ts; lib/sync/integration/account-switch.test.ts -->

### Requirement: Cursors follow the restored state (baseline, current behaviour)

The guard SHALL keep cursors a restored archive brought back, and SHALL write a fresh SyncStatus with
null cursors for the incoming user when none was restored.

#### Scenario: First sign-in on this device

- **WHEN** the incoming user has no archive
- **THEN** SyncStatus holds their id and null cursors

#### Scenario: Returning user

- **WHEN** the incoming user's archive holds a SyncStatus with their id
- **THEN** its cursors are kept

<!-- source: lib/sync/guardAccountSwitch.ts; lib/sync/guardAccountSwitch.test.ts -->

### Requirement: The archive holds per-user state (baseline, current behaviour)

`archiveUserData` SHALL snapshot the session, grade log, queue, streak, SyncStatus, settings, daily
summary, derived caches, translation banner dismissals and held grades, from localStorage and
IndexedDB, into one value under `poke-memory:user-archive:<userId>`.

#### Scenario: Held grades move with their owner

- **WHEN** a held grade exists at archive time
- **THEN** the archive holds it

<!-- source: lib/storage/userArchive.ts; lib/storage/userArchive.test.ts -->

### Requirement: A failed archive is reported

`archiveUserData` SHALL NOT throw. It SHALL report whether the archive was saved and, when it was not,
hand back the pending-grade queue and held grades, or nothing when there are none. It SHALL NOT log
that the cloud is intact.

#### Scenario: Quota error with queued grades

- **WHEN** the write fails with a quota error and the queue holds grades
- **THEN** the result is not saved, and carries the queue from both stores and the held grades only

#### Scenario: Quota error with an empty queue

- **WHEN** the write fails and the queue is absent or an empty list, with no held grades
- **THEN** the result is not saved and carries nothing

### Requirement: A failed archive keeps unpushed grades for their owner

When the archive fails with grades to keep, the guard SHALL still wipe, and SHALL then store those
grades under the outgoing user's archive key with their SyncStatus, cursors null and everything else
kept. The incoming user SHALL get none of them.

#### Scenario: Heavy user, then someone else signs in

- **WHEN** A's archive fails on quota with queued grades and B signs in
- **THEN** neither queue copy holds A's grades, and A's archive key does

#### Scenario: The owner returns

- **WHEN** A signs in again after that
- **THEN** both queue copies hold A's grades, and A's cursors are null so the pull rebuilds the session

#### Scenario: Owner has reset before

- **WHEN** A once reset progress and returns after a failed archive
- **THEN** `lastSeenResetAt` is kept, so the pull does not treat that reset as new and wipe the queue

#### Scenario: localStorage was already full

- **WHEN** per-user keys fill localStorage and the archive fails
- **THEN** the wipe frees the space and the grades are stored

#### Scenario: Non-English locale

- **WHEN** the queued grades are for a card in another locale
- **THEN** each comes back with its `locale`

#### Scenario: Nothing can be written

- **WHEN** storing the grades also fails
- **THEN** the switch completes and an error is logged

### Requirement: An archive is removed only after a full restore

`restoreUserData` SHALL remove the archive only when every localStorage key was written and every
IndexedDB value reads back the same. Otherwise it SHALL restore what it can and keep the archive.

#### Scenario: A key hits the quota

- **WHEN** one localStorage key fails on restore
- **THEN** the other keys are restored and the archive stays

#### Scenario: IndexedDB write does not land

- **WHEN** an IndexedDB value does not read back
- **THEN** the archive stays

#### Scenario: Full restore

- **WHEN** every key is written and reads back
- **THEN** the archive is removed
