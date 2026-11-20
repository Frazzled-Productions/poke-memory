## MODIFIED Requirements

### Requirement: Account deletion clears the cloud first, then the device (baseline, current behaviour)

`deleteAccountEverywhere` SHALL delete the cloud account first and return
`cloud-delete-failed` with local data untouched if that fails. On success it SHALL run
`clearLocalProgress`, which deletes the IndexedDB review session, grade log, migration flag and
pending-grade queue, then remove every `poke-memory:*` localStorage key on the device, including
settings, superuser keys and every `user-archive:*` key of any account, and leave other keys alone.

#### Scenario: Offline

- **WHEN** the cloud delete fails
- **THEN** no local data is cleared, and the pending-grade queue stays in both localStorage and IndexedDB

#### Scenario: Shared device

- **WHEN** player A deletes their account on a device holding player B's archive
- **THEN** B's archive is removed too

#### Scenario: Queued grades at a delete

- **WHEN** grades are queued and the cloud delete succeeds
- **THEN** the queue is in neither localStorage nor IndexedDB

Source: `lib/sync/deleteAccount.ts:41-57`, `lib/sync/deleteAccount.ts:77-88`,
`lib/storage/reset.ts:22-58`; tests `lib/sync/deleteAccount.test.ts:82-100`,
`components/settings/deleteAccount-local.test.tsx:59-77`, `lib/storage/reset.test.ts`
("deleteAccountEverywhere clears the IDB pending-grade queue", "keeps the IDB pending-grade queue
when the cloud delete fails").
