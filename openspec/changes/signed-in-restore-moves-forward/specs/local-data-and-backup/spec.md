## RENAMED Requirements

- FROM: `### Requirement: A restore replaces the session and settings, then reloads (baseline)`
- TO: `### Requirement: A guest or superuser restore replaces the session and settings, then reloads`

## MODIFIED Requirements

### Requirement: A guest or superuser restore replaces the session and settings, then reloads

After a file validates, Settings SHALL ask for confirmation. For a guest, or with a superuser flag on,
on yes `applyBackup` SHALL save the session and settings and the page SHALL reload; on no, nothing
changes. Each card's `state.stepStartedAt` SHALL be set to null and its other state kept. This restore
does not merge, and does not touch the grade log, streak, pending queue, sync status or the cloud. A
failed settings write is silent. Anyone else signed in takes the signed-in restore.

#### Scenario: Confirmed guest restore

- **WHEN** a guest confirms a valid backup
- **THEN** session and settings are replaced, card steps restart, and the page reloads

#### Scenario: Signed-in restore with different settings

- **WHEN** a signed-in user with no superuser flag on confirms a backup whose settings differ from the last pushed ones
- **THEN** this replace does not run: the signed-in restore leaves settings alone, so nothing is pushed for them

#### Scenario: Card with no name

- **WHEN** a valid file holds a name card with no `name` or `spriteUrl`, and is applied over three saved cards
- **THEN** `validateBackup` passes and the next `loadSession` returns null (run against fake-indexeddb, recorded in #2235)

#### Scenario: Non-English locale

- **WHEN** a Japanese-locale user imports a bad file
- **THEN** the error shows in English

#### Scenario: Superuser flag on

- **WHEN** a signed-in person with a superuser flag on confirms a valid backup
- **THEN** it behaves as a guest restore, with the guest confirmation, and writes nothing to the cloud

Looks wrong: #2239 (a failed session save is ignored and the page still reloads), #2235 (a file can pass
validation and then make the session unreadable), #2238 (errors and the guest dialog are English only).

Evidence: `app/settings/page.tsx` (`handleImport`); `lib/backup/io.ts:94-118`;
`lib/backup/schema.ts:16-22`; `lib/review/persistence.ts:32-53`, `:269-271`, `:338-358`;
`lib/settings/persistence.ts:1161-1179`; `lib/backup/io.test.ts:404`, `:472`, `:479`;
`e2e/backup.spec.ts:126`, `:196`; `app/settings/page.test.tsx` "SettingsPage - backup restore (#2218)".

## ADDED Requirements

### Requirement: A signed-in restore only moves cards forward

For a signed-in person with no superuser flag on, a restore SHALL pull the account's cards first and
use a backup card only when it is further on than both the cloud and this device. "Further on" SHALL
mean the regression trigger would accept the write and a guarded field differs. Other copies SHALL be
kept. Further-on backup cards that carry a review SHALL be pushed to the cloud, and an older queued
copy of a pushed card SHALL leave the pending queue. The cloud SHALL NOT go down.

#### Scenario: Backup older than the account

- **WHEN** the cloud holds a card at reps 9, the backup holds it at reps 4, and this device has no copy
- **THEN** the cloud row is unchanged and this device holds the reps 9 copy

#### Scenario: Backup older than the account, device already behind

- **WHEN** the cloud holds a card at reps 9, the backup holds it at reps 4, and this device holds reps 4
- **THEN** the cloud row is unchanged and this device keeps its copy; a later pull brings reps 9 only if the row changed since this device's last pull

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

#### Scenario: Queued copy overtaken by the backup

- **WHEN** the pending queue holds an older copy of a card the restore pushes, and the push succeeds
- **THEN** that copy leaves the queue and other queued grades stay

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

### Requirement: Future-dated cards stay out

A signed-in restore SHALL leave out a backup card whose first seen or last review date is after
tomorrow in UTC, the furthest ahead any timezone's today can be. Nothing in the database caps
`last_review`, so such a card in the cloud would make the regression trigger refuse every real grade of
it until that date.

#### Scenario: Backup from a device with a wrong clock

- **WHEN** a signed-in person restores a backup holding a card last reviewed on 2099-01-01
- **THEN** the card is neither saved on this device nor pushed, and the other cards restore as usual

### Requirement: A signed-in restore leaves settings and limits alone

A signed-in restore SHALL NOT change settings, and SHALL keep this device's daily limits; the backup's
limits are used only on a device with no saved session.

#### Scenario: Older settings in the backup

- **WHEN** a signed-in person restores a backup holding older settings
- **THEN** settings are unchanged and later settings saves still sync

#### Scenario: Fresh device

- **WHEN** a signed-in person restores a backup on a device with no saved session
- **THEN** the backup's daily limits are saved with the cards

### Requirement: Settings says what a signed-in restore does

Settings SHALL describe the signed-in restore in its description and confirmation, in every locale,
and SHALL show an error when a restore could not run, naming the account when a read failed and this
device when the save failed.

#### Scenario: Confirmation in a non-English locale

- **WHEN** a signed-in person using Japanese imports a valid backup
- **THEN** the confirmation is the catalogue's Japanese `importConfirmSignedIn` string

#### Scenario: Account could not be reached

- **WHEN** a signed-in restore fails because a read failed
- **THEN** Settings shows `importFailedSignedIn` and does not reload

#### Scenario: Device storage full

- **WHEN** a signed-in restore fails because this device could not save the session
- **THEN** Settings shows `importSaveFailedSignedIn`, not the connection message, and does not reload
