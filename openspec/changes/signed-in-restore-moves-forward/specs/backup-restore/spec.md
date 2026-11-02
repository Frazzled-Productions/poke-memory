## Purpose

Backup restore lets a person export their progress to a JSON file and bring it back later from
Settings. This baseline records current behaviour on `qa`, and change signed-in-restore-moves-forward
adds what a restore means for a signed-in person. Requirements marked baseline describe the code as
it stands.

## ADDED Requirements

### Requirement: Export writes a versioned backup file (baseline, current behaviour)

Export SHALL download `poke-memory-backup-<date>.json` holding the backup version, the export time,
the session's cards and limits, and the settings. `grade_log` and `streak_days` are not in the file.

#### Scenario: Export from Settings

- **WHEN** a person presses Export in Data & backup
- **THEN** a file named `poke-memory-backup-YYYY-MM-DD.json` downloads with version 1

### Requirement: An invalid file is refused before any change (baseline, current behaviour)

Import SHALL refuse a file that is not valid JSON, has another version, fails the shape check, or holds
a card id outside the seed. It SHALL show an error, show no confirmation and write nothing.

#### Scenario: Not a backup

- **WHEN** a person imports a file that fails validation
- **THEN** Settings shows "This file isn't a valid poke-memory backup." and no dialog appears

### Requirement: A guest or superuser restore replaces local data (baseline, current behaviour)

After confirmation, a restore by a guest, or by anyone with a superuser flag on, SHALL save the backup's
session and settings over local data and reload the page. Nothing SHALL be written to the cloud.

#### Scenario: Guest restore

- **WHEN** a guest confirms "Replace your current progress with this backup?"
- **THEN** the backup replaces the local session and settings and the page reloads

#### Scenario: Superuser flag on

- **WHEN** a signed-in person with a superuser flag on confirms a restore
- **THEN** it behaves as a guest restore and writes nothing to the cloud

### Requirement: A signed-in restore only moves cards forward

For a signed-in person with no superuser flag on, a restore SHALL pull the account's cards first and
use a backup card only when it is further on than both the cloud and this device. "Further on" SHALL
mean the regression trigger would accept the write and a guarded field differs. Other copies SHALL be
kept. Further-on backup cards that carry a review SHALL be pushed to the cloud. The cloud SHALL NOT
go down.

#### Scenario: Backup older than the account

- **WHEN** the cloud holds a card at reps 9 and the backup holds it at reps 4
- **THEN** the cloud row is unchanged and this device holds the reps 9 copy

#### Scenario: Next grade after an older backup

- **WHEN** a person restores an older backup, the app pulls, and they grade that card
- **THEN** the grade reaches the cloud

#### Scenario: Backup ahead of the account

- **WHEN** the backup holds a card further on than the cloud
- **THEN** the cloud moves to that copy and this device holds it

#### Scenario: Two devices syncing

- **WHEN** a restore moves a card forward and another device then pulls
- **THEN** the other device gets the restored card

#### Scenario: Card the cloud has not seen

- **WHEN** the backup holds a reviewed card with no cloud row
- **THEN** the row is added to the cloud

#### Scenario: Grade waiting to sync

- **WHEN** this device holds a grade still in the pending queue and the backup's copy is older
- **THEN** this device keeps the grade, the queue keeps it, and it still reaches the cloud

#### Scenario: Offline

- **WHEN** the pull fails
- **THEN** nothing changes on this device or in the cloud, and Settings says nothing was restored

#### Scenario: Last reset cannot be read

- **WHEN** the card pull succeeds but the read of the account's last reset fails
- **THEN** nothing changes on this device or in the cloud, and Settings says nothing was restored

#### Scenario: App closed after a failed push

- **WHEN** the pull succeeds, the push fails and the page reloads
- **THEN** this device holds the restored cards and they stay in the pending queue for the normal retry

#### Scenario: A non-English locale

- **WHEN** the backup holds a card for a Japanese-language enrolment
- **THEN** it is matched by card type, subject and locale, so the English row is not touched

### Requirement: Cards from before the last reset stay out

A signed-in restore SHALL leave out a backup card whose first seen or last review date is before the
account's last reset, because the database refuses it on every push.

#### Scenario: Restore after a reset

- **WHEN** a person resets all progress and then restores a backup from before the reset
- **THEN** the card is not restored, so this device and the cloud both hold no progress for it

### Requirement: A signed-in restore leaves settings and limits alone

A signed-in restore SHALL NOT change settings or this device's daily limits.

#### Scenario: Older settings in the backup

- **WHEN** a signed-in person restores a backup holding older settings
- **THEN** settings are unchanged and later settings saves still sync

### Requirement: Settings says what a signed-in restore does

Settings SHALL describe the signed-in restore in its description and confirmation, in every locale,
and SHALL show an error when a restore could not run.

#### Scenario: Confirmation in a non-English locale

- **WHEN** a signed-in person using Japanese imports a valid backup
- **THEN** the confirmation is the catalogue's Japanese `importConfirmSignedIn` string

#### Scenario: Restore could not run

- **WHEN** a signed-in restore fails
- **THEN** Settings shows `importFailedSignedIn` and does not reload
