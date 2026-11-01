## Purpose

Background Sync replay sends queued grades to the cloud when the browser reconnects, even with every
tab closed. It is Chromium-only progressive enhancement. This baseline records current behaviour on
`qa`, and change background-sync-permanent-errors adds how permanent refusals are handled.
Requirements marked baseline describe the code as it stands.

## ADDED Requirements

### Requirement: An open tab pushes first (baseline, current behaviour)

When a `poke-memory:grade-sync` event fires and clients controlled by this worker exist, the worker
SHALL post `BACKGROUND_SYNC_REPLAY` to each over a `MessageChannel` and wait up to 3 seconds. If any
client ACKs, the worker SHALL resolve without reading the queue or posting. If none does, it SHALL push
the queue itself.

#### Scenario: A tab answers

- **WHEN** one of several clients ACKs
- **THEN** the worker makes no request and leaves the queue alone

#### Scenario: A frozen tab

- **WHEN** clients exist and none ACKs within 3 seconds
- **THEN** the worker posts the queue, and not before the 3 seconds are up

<!-- source: lib/pwa/swReplay.ts; lib/pwa/swReplayHandler.test.ts -->

### Requirement: With no tab, the worker posts the queue (baseline, current behaviour)

With no client to answer, the worker SHALL read the IndexedDB copy of the pending-grade queue and POST
it unchanged to `/api/sync` as `{ cards }` with credentials included. With an empty queue it SHALL
resolve without a request.

#### Scenario: App closed, grades queued

- **WHEN** a sync event fires with every tab closed and rows in the queue
- **THEN** the rows are posted to `/api/sync` with cookies

#### Scenario: Guest or superuser session

- **WHEN** a sync event fires and no queue was written
- **THEN** the worker resolves without a request

<!-- source: lib/pwa/swReplay.ts; lib/pwa/swReplayHandler.test.ts; lib/sync/backgroundSync.ts -->

### Requirement: Success and auth failure end the replay (baseline, current behaviour)

On a 2xx, 401 or 403 the worker SHALL resolve and clear the IndexedDB copy of the queue. It SHALL NOT
touch the localStorage copy, which a worker cannot reach.

#### Scenario: Session expired

- **WHEN** `/api/sync` answers 401 or 403
- **THEN** the event resolves and the IndexedDB copy is gone

#### Scenario: Pushed

- **WHEN** `/api/sync` answers 200
- **THEN** the event resolves and the IndexedDB copy is gone

<!-- source: lib/pwa/swReplay.ts; lib/pwa/swReplayHandler.test.ts; docs/sync.md -->

### Requirement: Transient failures retry (baseline, current behaviour)

On a network error, a 5xx or any non-2xx status not named elsewhere in this spec, the worker SHALL
reject, so the browser retries the event, and SHALL keep the queue.

#### Scenario: Offline again

- **WHEN** the request fails
- **THEN** the event rejects and the queue is kept

#### Scenario: Server error

- **WHEN** `/api/sync` answers 502
- **THEN** the event rejects and the queue is kept

#### Scenario: Any other refusal

- **WHEN** a 404, 408, 413 or 429 comes back for `/api/sync`
- **THEN** the event rejects and the queue is kept

<!-- source: lib/pwa/swReplay.ts; lib/pwa/swReplayHandler.test.ts -->

### Requirement: A permanent refusal stops the retries and keeps the grades

On a 400 or 409 from `/api/sync` the worker SHALL resolve, so the browser does not send the same
request again, and SHALL keep the queue, because those grades are not in the cloud.

#### Scenario: Structural error, app closed

- **WHEN** `/api/sync` answers 409 with every tab closed
- **THEN** the event resolves, no further request is made for that event, and the queue is kept

#### Scenario: Invalid payload

- **WHEN** `/api/sync` answers 400
- **THEN** the event resolves and the queue is kept

#### Scenario: The app opens later

- **WHEN** the app next opens after a 409 replay
- **THEN** its own push sends the localStorage copy and shows the structural-error banner if the 409
  persists

<!-- source: lib/pwa/swReplay.ts; lib/pwa/swReplayHandler.test.ts; lib/sync/useSyncOnUnload.ts -->
