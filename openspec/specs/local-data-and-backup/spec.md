# local-data-and-backup Specification

## Purpose
Where Poké Memory keeps data on the device, and how that data is reset, archived on an account switch,
exported and restored, plus the review-history CSV and the plain-language privacy summary. This is the
baseline: current behaviour on `qa` at d2456f44, written from code and tests. It says what is true
today, not what should be. Where the behaviour looks wrong, the requirement says so and names the
issue; those lines are what a later change would MODIFY. Cloud merge, the sync queues and the service
worker's replay belong to `cloud-sync`, and are only touched where this capability calls them.

## Requirements

### Requirement: Storage keys come from one registry with stable strings (baseline)

Persistence modules SHALL take their main localStorage key strings from `lib/storage/keys.ts`, in the
form `poke-memory:<domain>[:<variant>][:v<n>]`, and those strings SHALL NOT change, because browsers
already hold data under them. The registry is not complete: some keys are declared where they are used.

#### Scenario: A pinned key

- **WHEN** the key test reads `KEY_REVIEW_SESSION`
- **THEN** it equals `poke-memory:review-session:v1` byte for byte

#### Scenario: A collapsible section's key

- **WHEN** Settings remembers that a section is open
- **THEN** it writes under `poke-memory:settings-section:`, a prefix the registry does not list

Evidence: `lib/storage/keys.ts:5-11`, `:17`, `:22`, `:32`; `lib/storage/keys.test.ts:31-71` pins 14 of
them. Declared elsewhere: `components/settings/CollapsibleSection.tsx:7`,
`components/review/ReviewSession.tsx:132`, `components/onboarding/PwaInstallNudge.tsx:12`.

### Requirement: The localStorage helpers never throw (baseline)

`readLocalStorage` SHALL return the fallback on the server, when the key is absent, or when reading or
parsing throws. `writeLocalStorage` and `writeLocalStorageRaw` SHALL do nothing on the server and SHALL
swallow serialise, quota and security errors, so a caller cannot tell that a write failed. With
`notify`, they SHALL dispatch a same-tab `storage` event only after a successful write.

#### Scenario: Malformed JSON

- **WHEN** the stored value makes `parse` throw
- **THEN** the caller gets the fallback and nothing propagates

#### Scenario: Storage full with notify on

- **WHEN** `setItem` throws a quota error and `notify` is true
- **THEN** the call returns normally and no `storage` event fires

Evidence: `lib/storage/readLocalStorage.ts:25-37`; `lib/storage/writeLocalStorage.ts:40-70`, `:81-105`;
`lib/storage/readLocalStorage.test.ts:77`, `:101`; `lib/storage/writeLocalStorage.test.ts:202`, `:219`,
`:250`.

### Requirement: One IndexedDB database at version 2 with two stores (baseline)

The app SHALL open the `poke-memory` database at version 2 with a `kv` store and an `offline-pack`
store, as a single shared promise. The upgrade SHALL keep existing `kv` data. `lib/pwa/offlineStore.ts`
takes the version from `DB_VERSION`; `app/sw.ts` holds its own copy, a constant that SHALL equal it.

#### Scenario: Upgrade from version 1

- **WHEN** a browser holding version 1 data opens the database
- **THEN** the `kv` values are still readable and `offline-pack` exists

#### Scenario: Server render

- **WHEN** `openAppDb` is called with no `window`
- **THEN** it returns a promise that never settles

Evidence: `lib/idb/db.ts:9`, `:21-23`, `:29-49`; `lib/pwa/offlineStore.ts:55`; `app/sw.ts:67-70`,
`:466-481`; `lib/idb/db.test.ts:67-85`, `:111`, `:142`.

### Requirement: Version conflicts close or wait, with no timeout (baseline)

A connection that blocks a newer version SHALL close and clear the shared promise. A connection blocked
by an older one SHALL log a warning and wait. The app's `openAppDb` has no timeout on that wait, so its
IndexedDB reads stay pending until the old connection closes. The service worker's opener does time out.

#### Scenario: Another tab holds an older connection

- **WHEN** an upgrade is blocked by a connection elsewhere
- **THEN** a warning is logged and the open stays pending until that connection closes

Evidence: `lib/idb/db.ts:50-64`; `app/sw.ts:452-465`.

### Requirement: One IndexedDB failure turns it off until the next page load (baseline)

`idbGet`, `idbSet` and `idbDelete` SHALL never throw. On any failure, or when the open fails, they SHALL
log a warning and set `idbAvailable` to false, after which later calls SHALL do nothing (`idbGet` returns
null) until the page reloads. A non-string value in `kv` SHALL read as null.

#### Scenario: A read fails once

- **WHEN** `db.get` throws
- **THEN** `idbGet` returns null, `isIdbAvailable()` is false, and the next `idbGet` does not touch the database

Evidence: `lib/idb/db.ts:65-70`, `:81-115`; `lib/idb/db.test.ts:272-284`, `:314-327`, `:357-369`,
`:398-403`.

### Requirement: Session and grade log move from localStorage to IndexedDB once (baseline)

On each load `IdbMigration` SHALL call `migrateFromLocalStorage`. When `migration_done_v1` is not set,
one transaction SHALL set it and copy the review session and grade log into `kv`, and the localStorage
copies SHALL be removed only after that transaction commits. When the flag is set it SHALL do nothing. A
failure SHALL log a warning and turn IndexedDB off.

#### Scenario: Two tabs race

- **WHEN** the flag appears between the first check and the transaction
- **THEN** the transaction aborts and the data is left as it was

#### Scenario: Second load

- **WHEN** the flag is already true and localStorage holds a session
- **THEN** nothing is copied and IndexedDB keeps its value

Evidence: `components/IdbMigration.tsx:11-14`; `lib/idb/db.ts:135`, `:148-193`;
`lib/idb/db.test.ts:491-529`, `:551`.

### Requirement: The session and grade log are read from IndexedDB first (baseline)

`loadSession` and `loadGradeLog` SHALL read IndexedDB while it is available and SHALL read localStorage
only when it is off or holds nothing for that key. Saves SHALL go to IndexedDB, or to localStorage when
it is off or the write fails. The localStorage grade log SHALL be trimmed oldest-first to 4.5 MB, keeping
at least 100 entries.

#### Scenario: Offline guest, normal load

- **WHEN** a guest opens the app with no network and IndexedDB holds a session
- **THEN** the session loads from IndexedDB

#### Scenario: A save during an IndexedDB failure, then a reload

- **WHEN** one card is saved to IndexedDB, a failed write sends a two-card save to localStorage, and the page reloads
- **THEN** `saveSession` returned ok and `loadSession` returns the one-card IndexedDB copy (run against fake-indexeddb, recorded in #2236)

Looks wrong (#2236): localStorage writes made while IndexedDB is off are not read back after a reload
once IndexedDB holds a value, and nothing merges them.

Evidence: `lib/review/persistence.ts:297-324`, `:436-465`; `lib/gradelog/persistence.ts:93-99`,
`:175-192`, `:200-236`.

### Requirement: A local reset clears progress but keeps settings and archives (baseline)

`clearLocalProgress` SHALL remove every localStorage key starting `poke-memory:` except those starting
`poke-memory:settings:` or `poke-memory:user-archive:`, and SHALL delete the IndexedDB review session,
grade log and migration flag. A localStorage error SHALL NOT stop the IndexedDB deletes. It SHALL then
dispatch same-tab `storage` events for the session and grade-log keys. It does not touch the cloud.

#### Scenario: Shared device

- **WHEN** a reset runs and another account's archive is on the device
- **THEN** that archive remains

#### Scenario: Device-level keys go too

- **WHEN** a reset runs with the superuser unlock and a remembered Settings section stored
- **THEN** both are removed, because only the two prefixes are spared

#### Scenario: Open pages update

- **WHEN** a reset finishes with Stats or Pasture subscribed
- **THEN** they receive `storage` events for both keys and show the empty state without a reload

Evidence: `lib/storage/reset.ts:18-70`; `lib/storage/reset.test.ts:117`, `:135`, `:155`, `:168`.

### Requirement: Reset order depends on who is signed in (baseline)

Settings SHALL do nothing on reset while a superuser flag is on. For a signed-in user it SHALL reset the
cloud first and SHALL leave local data alone if that fails. For a guest it SHALL call
`clearLocalProgress`. The error screen SHALL offer "reset local data" only once auth has settled and the
user is a guest; a signed-in user gets a hint instead.

#### Scenario: Cloud reset fails

- **WHEN** a signed-in reset cannot reach the cloud
- **THEN** an error is raised and local data is unchanged

#### Scenario: Superuser flag on

- **WHEN** a superuser flag is on and the user confirms a reset
- **THEN** nothing is cleared

Evidence: `app/settings/page.tsx:678-689`; `lib/sync/reset.ts:50-56`; `app/error.tsx:59-63`, `:128-139`.

### Requirement: Account deletion clears all local keys, for every account (baseline)

`deleteAccountEverywhere` SHALL delete the cloud account first and SHALL leave local data alone if that
fails. On success it SHALL run `clearLocalProgress`, then remove every `poke-memory:*` localStorage key,
including settings.

#### Scenario: Cloud deletion fails

- **WHEN** the `delete_account` call fails
- **THEN** the result is `cloud-delete-failed` and local data is unchanged

#### Scenario: Shared device

- **WHEN** one account is deleted and another account's archive is on the device
- **THEN** that archive is removed

Looks wrong (#2237): that sweep also removes other accounts' archives on the device.

Evidence: `lib/sync/deleteAccount.ts:41-57`, `:77-88`; `lib/storage/keys.ts:261-262`;
`lib/sync/deleteAccount.test.ts:82`, `:100`.

### Requirement: A confirmed account switch archives, clears and restores (baseline)

`guardAccountSwitch` SHALL do nothing when no owner is recorded or the incoming user is the owner, so a
guest who signs in keeps local data. For a different user it SHALL, in order: archive the outgoing user;
delete the IndexedDB pending queue, session and grade log; wipe per-user localStorage keys, including
settings; restore any archive of the incoming user; and write a fresh sync status when the restored one
does not belong to them. Device-level keys listed in the wipe SHALL stay.

#### Scenario: Guest then sign-in

- **WHEN** a guest signs in and no owner is recorded
- **THEN** nothing is archived or cleared

#### Scenario: Different user signs in

- **WHEN** user B signs in over user A's local data
- **THEN** A's data is in A's archive and the IndexedDB session and grade log are gone before B's archive is restored

Evidence: `lib/sync/guardAccountSwitch.ts:66-102`, `:109-174`; `lib/storage/userArchive.ts:199-201`,
`:225-238`; `lib/storage/userArchive.test.ts:265`, `:274-292`.

### Requirement: The archive is one localStorage value per user (baseline)

`archiveUserData` SHALL write one JSON blob (`v: 1`, `ls`, `idb`) under
`poke-memory:user-archive:<userId>`, holding the listed per-user localStorage keys, MT-banner and
held-grade keys found by prefix, and the IndexedDB session, grade log and pending queue, omitting absent
keys. Derived cache keys (`has-mastered:v2` and the per-locale counts) are archived and restored, though
the file header says they are cleared. A failure SHALL be logged and SHALL NOT stop the switch.

#### Scenario: Quota error

- **WHEN** the archive does not fit in localStorage
- **THEN** a warning is logged and the switch carries on with no archive written

#### Scenario: Two devices

- **WHEN** a user archived on one device signs in on another
- **THEN** that archive is not available there, because it exists only on the first device

Known limits: #2208 (a failed archive) and #2214 (size).

Evidence: `lib/storage/keys.ts:263-268`; `lib/storage/userArchive.ts:19-22`, `:52-72`, `:90-132`;
`lib/storage/userArchive.test.ts:92-167`.

### Requirement: Restoring an archive consumes it (baseline)

`restoreUserData` SHALL do nothing when the user has no archive, and SHALL log and ignore a blob that is
not an object or has the wrong `v`. Otherwise it SHALL write each `ls` key, skipping any that fails,
write the `idb` keys, remove the archive, and dispatch `storage` events for the session and grade log.

#### Scenario: Returning user

- **WHEN** a user with an archive signs back in
- **THEN** their keys are restored, the archive is gone and subscribers are told

#### Scenario: Wrong version tag

- **WHEN** the blob's `v` is not 1
- **THEN** a warning is logged and the blob stays where it is

Known limit: #2208 (the archive is removed even when a key was skipped).

Evidence: `lib/storage/userArchive.ts:145-192`; `lib/storage/userArchive.test.ts:183-253`.

### Requirement: The JSON backup holds cards, limits and settings only (baseline)

`exportProgress` SHALL download `poke-memory-backup-<date>.json` with `version` 1, `exportedAt`, `cards`,
`limits` and `settings`, for guests and signed-in users, from local data with no network call. It SHALL
use an empty card list and default limits when no session loads. The grade log, streak, daily summary and
sync state are not in the file.

#### Scenario: Offline export

- **WHEN** a guest with no network presses Export
- **THEN** the file downloads from local data

#### Scenario: No saved session

- **WHEN** `loadSession` returns null
- **THEN** the file has an empty `cards` array and default limits

Evidence: `lib/backup/io.ts:35-61`; `lib/backup/schema.ts:6-14`; `app/settings/page.tsx:1929-1935`;
`lib/backup/io.test.ts:348-372`; `e2e/backup.spec.ts:87`.

### Requirement: A backup file must match the schema (baseline)

`isBackupFile` SHALL require `version` 1, a string `exportedAt`, a `cards` array of base-shaped cards,
`limits.name` and `limits.evolution` with numeric per-day limits, and the five numeric core settings.
`limits.reverse` and other settings are optional. `validateBackup` SHALL answer "This file isn't a valid
poke-memory backup." for unreadable or malformed files, and "Backup version N isn't supported." for a
`version` that is present and not 1. A failed check SHALL write nothing.

#### Scenario: Newer version

- **WHEN** the file has `version: 2`
- **THEN** the error is "Backup version 2 isn't supported."

#### Scenario: Missing version

- **WHEN** the file has no `version`
- **THEN** the error is "This file isn't a valid poke-memory backup."

Evidence: `lib/backup/schema.ts:34-74`; `lib/backup/io.ts:63-85`; `lib/backup/schema.test.ts:38-426`;
`lib/backup/io.test.ts:437-472`.

### Requirement: Card ids are checked against part of the seed (baseline)

With the seed loaded, `validateBackup` SHALL refuse a file holding a card whose id is not a name id, a
forward edge id or a reverse name id. With the seed not loaded the check SHALL be skipped, despite the
comment saying it falls through to the error path.

#### Scenario: Unknown id

- **WHEN** the seed is loaded and a card has id 9999
- **THEN** the error is "This file isn't a valid poke-memory backup."

#### Scenario: An exported cry or reverse-evolution card

- **WHEN** the seed is loaded and the file holds a card with id 3000001 or 2500001
- **THEN** the same error is returned (run against the real seed, recorded in #2234)

Looks wrong (#2234): reverse-evolution and cry ids are not in the set, so a backup the app exported with
those cards is refused. Legacy-range evolution ids are refused the same way, so the legacy shapes the
schema accepts cannot get through when the seed is loaded.

Evidence: `lib/backup/io.ts:12-27`, `:87-92`; `lib/pokemon/seed-constants.ts:9-27`;
`lib/review/session.ts:197-206`, `:220-232`; `lib/backup/io.test.ts:425`, `:454`.

### Requirement: A restore replaces the session and settings, then reloads (baseline)

After a file validates, Settings SHALL ask for confirmation. On yes, `applyBackup` SHALL save the session
and settings and the page SHALL reload; on no, nothing changes. Each card's `state.stepStartedAt` SHALL be
set to null and its other state kept. The restore does not merge, and does not touch the grade log,
streak, pending queue, sync status or cloud. There is no superuser guard, unlike reset.

#### Scenario: Confirmed guest restore

- **WHEN** a guest confirms a valid backup
- **THEN** session and settings are replaced, card steps restart, and the page reloads

#### Scenario: Card with no name

- **WHEN** a valid file holds a name card with no `name` or `spriteUrl`, and is applied over three saved cards
- **THEN** `validateBackup` passes and the next `loadSession` returns null (run against fake-indexeddb, recorded in #2235)

#### Scenario: Non-English locale

- **WHEN** a Japanese-locale user imports a bad file
- **THEN** the error shows in English

#### Scenario: Superuser flag on

- **WHEN** a superuser flag is on and the user confirms a valid backup
- **THEN** the restore runs

Looks wrong: #2239 (a failed session save is ignored and the page still reloads), #2235 (a file can pass
validation and then make the session unreadable), #2238 (errors and dialog are English only). The outcome
for a signed-in user is undefined (#2218).

Evidence: `app/settings/page.tsx:704-721`, `:1961-1980`; `lib/backup/io.ts:94-118`;
`lib/backup/schema.ts:16-22`; `lib/review/persistence.ts:32-53`, `:269-271`, `:338-358`;
`lib/backup/io.test.ts:404`, `:472`, `:479`; `e2e/backup.spec.ts:126`, `:196`.

### Requirement: Review-history CSV is for signed-in users (baseline)

`GET /api/export` SHALL answer 401 without a session, and 503 `service_unavailable` when the client cannot
be built or a read fails, while re-throwing Next.js control errors that carry a `digest`. Settings SHALL
show the download link to signed-in users only, as a plain link with no error handling, so a failure
produces no message in the app. The service worker SHALL NOT cache it, so it needs a network connection.

#### Scenario: Guest calls the route

- **WHEN** a request arrives with no session
- **THEN** the answer is 401 and no rows are read

#### Scenario: Supabase read fails

- **WHEN** the `grade_log` read errors
- **THEN** the answer is 503

Evidence: `app/api/export/route.ts:97-112`, `:132-141`; `lib/auth/requireAuth.ts:35`;
`app/settings/page.tsx:1939-1954`; `lib/pwa/cacheStrategy.ts:121-130`;
`app/api/export/route.test.tsx:113`, `:123`, `:310`; `e2e/settings.spec.ts:462`.

### Requirement: The CSV holds every grade_log row in order (baseline)

The route SHALL read the user's `grade_log` rows 1,000 at a time until a short page, ordered by
`entry_date` then `occurred_at`, and one failed page SHALL fail the whole export. It covers `grade_log`
only: no settings, card state or streak.

#### Scenario: More than 1,000 rows

- **WHEN** a user has 2,500 rows
- **THEN** three pages are read and the CSV has all 2,500 rows

Evidence: `app/api/export/route.ts:114-141`; `lib/sync/paginatedFetch.ts:31-52`.

### Requirement: The CSV format (baseline)

The body SHALL start with a UTF-8 byte order mark, use CRLF line ends and the header
`date,pokemon,card_type,grade,grade_label`, and quote fields per RFC 4180. `pokemon` SHALL be the display
name, `From -> To` for edges, the `subject_key` when it cannot be resolved, and empty when it is null.
`evolution-edge` and `reverse-evolution-edge` SHALL appear as `evolution` and `reverse-evolution`. Grades
1, 2, 4 and 5 SHALL be labelled Again, Hard, Good and Easy. The response SHALL be a `no-store` CSV
attachment named `poke-memory-reviews-<UTC date>.csv`.

#### Scenario: Date column

- **WHEN** a review was graded late in the evening in a timezone ahead of or behind UTC
- **THEN** `date` is the stored `entry_date`, the day in the user's timezone, not UTC as the route's header comment says

#### Scenario: Evolution row

- **WHEN** a row has card type `evolution-edge`
- **THEN** the line shows `From -> To`, `evolution`, the grade and its label

#### Scenario: No rows

- **WHEN** the user has no reviews
- **THEN** the CSV holds the byte order mark and header only

Evidence: `app/api/export/route.ts:11`, `:39-66`, `:69-79`, `:90-95`, `:143-190`;
`components/review/ReviewSession.tsx:2640`, `:2977`; `lib/sync/gradeLog.ts:42`;
`app/api/export/route.test.tsx:133-151`, `:161-236`, `:256-295`.

### Requirement: The privacy page shows a plain-language summary (baseline)

`ChildFriendlySummary` SHALL render a labelled section with six translated list items, bold labels, and
links to `/settings#backup-heading` and `/settings#danger-zone-heading`, both of which exist and open
their collapsed section.

#### Scenario: Non-English locale

- **WHEN** the page is shown in Japanese
- **THEN** the heading and items are in Japanese

#### Scenario: Export link

- **WHEN** a reader follows "export your progress"
- **THEN** they land on `/settings#backup-heading`

Looks wrong (#2240): item 3 says nothing beyond card progress is saved and that we do not know the
user's name, while settings go to the cloud and a sign-in handle is shown on Journey.

Evidence: `components/privacy/ChildFriendlySummary.tsx:5-55`; `app/privacy/page.tsx:44`;
`app/settings/page.tsx:312`, `:318`, `:1924`, `:2227`; `messages/en.json:1262`;
`components/privacy/ChildFriendlySummary.test.tsx:187-213`, `:234-281`; `e2e/privacy.spec.ts:45-56`.

## Clarifications

Dated 2 November 2026. This baseline was written unattended, so each open call carries a recommendation
and none has an owner answer yet.

- Should the JSON backup carry the grade log and streak? A guest moving device loses history and streak.
  Recommend: yes, as a schema version bump, grilled with #2218.
- Should the CSV link show an error? A failed request gives no message in the app. Recommend: yes, a small fix.
- Should the app's IndexedDB open time out, as the service worker's does? Recommend: look at it with #2236.
- Should the header comments be corrected (UTC in `app/api/export/route.ts:11`, derived keys in
  `lib/storage/userArchive.ts:19-22`, the seed fallback in `lib/backup/io.ts:12-14`, "every key" in
  `lib/storage/keys.ts:2`)? Recommend: yes, on the next change to each file.
- Should legacy-range evolution ids pass the id check? Recommend: decide with #2234, since the schema accepts them.
