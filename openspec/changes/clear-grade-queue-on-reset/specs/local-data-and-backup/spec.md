## MODIFIED Requirements

### Requirement: A local reset clears progress but keeps the settings keys and archives (baseline)

`clearLocalProgress` SHALL remove every localStorage key starting `poke-memory:` except those starting
`poke-memory:settings:` or `poke-memory:user-archive:`, and SHALL delete the IndexedDB review session,
grade log, migration flag and pending-grade queue. A localStorage error SHALL NOT stop the IndexedDB
deletes. It SHALL then dispatch same-tab `storage` events for the session and grade-log keys. It does
not touch the cloud or the `offline-pack` store.

#### Scenario: Shared device

- **WHEN** a reset runs and another account's archive is on the device
- **THEN** that archive remains

#### Scenario: Device-level keys go too

- **WHEN** a reset runs with the superuser unlock and a remembered Settings section stored
- **THEN** both are removed, because only the two prefixes are spared

#### Scenario: Offline download

- **WHEN** a reset runs after an offline download
- **THEN** the download date and manifest keys are removed and the files stay in `offline-pack`

#### Scenario: Reset after an IndexedDB failure

- **WHEN** a reset runs on a page where IndexedDB has turned off, and the page reloads
- **THEN** the IndexedDB session is still there (run against fake-indexeddb, recorded in #2337)

#### Scenario: Open pages update

- **WHEN** a reset finishes with Stats or Pasture subscribed
- **THEN** they receive `storage` events for both keys and show the empty state without a reload

#### Scenario: Queued grades at a reset

- **WHEN** a reset runs with grades in the pending-grade queue
- **THEN** the queue is in neither localStorage nor IndexedDB

#### Scenario: App closed with a sync tag still registered

- **WHEN** Background Sync fires after a reset
- **THEN** the service worker finds an empty queue and sends nothing

Looks wrong (#2337): the deletes do nothing while IndexedDB is off, and the data returns on reload.

Evidence: `lib/storage/reset.ts:22-75`; `lib/storage/keys.ts:43`, `:135`, `:147`; `app/sw.ts:544`, `:678`;
`lib/storage/reset.test.ts:143`, `:161`, `:181`, `:233`.
