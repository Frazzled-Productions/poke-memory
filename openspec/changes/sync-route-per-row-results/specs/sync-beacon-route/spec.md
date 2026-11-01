## Purpose

`POST /api/sync` is the write path for the page-close beacon and the service worker's replay of the
pending-grade queue. Its status code tells the caller whether to keep the queue. This is a baseline
written from `app/api/sync/route.ts` and its tests on 2 November 2026 (#2206); the one requirement
marked "(changed)" is new behaviour, the rest describe the route as it was.

## ADDED Requirements

### Requirement: Rejected requests (baseline)

The route SHALL return 400 for a body that is not valid JSON or whose `cards` is not an array, and 401
when no user is signed in, with no upsert in either case.

#### Scenario: Guest posts a queue
- **WHEN** a request arrives with no signed-in user
- **THEN** the route returns 401 and writes nothing

#### Scenario: Malformed payload
- **WHEN** `cards` is missing or is not an array
- **THEN** the route returns 400

### Requirement: Card upserts in batches (baseline)

The route SHALL upsert `card_reviews` in batches of at most 200 rows, always under the signed-in user's
id, omitting `updated_at`. An empty `cards` array SHALL return 200 with no upsert.

#### Scenario: Large queue
- **WHEN** 201 cards arrive and every upsert succeeds
- **THEN** the route makes two batch upserts and returns 200

### Requirement: Batch transient failure (baseline)

A batch that fails with an error that is neither structural nor `23514` SHALL be tried up to three
times. If it still fails, later batches SHALL still run and the route SHALL return 502 with
`partial_failure`.

#### Scenario: Blip on the second attempt
- **WHEN** the first attempt fails and the second succeeds
- **THEN** the route returns 200

#### Scenario: Every attempt fails
- **WHEN** all three attempts fail
- **THEN** the route returns 502 and the caller keeps its queue

### Requirement: Batch structural failure (baseline)

A batch that fails with a structural error (`isStructuralError`) SHALL stop the request at once, with no
retry, and the route SHALL return 409 with `structural_error` and the SQLSTATE.

#### Scenario: Schema mismatch
- **WHEN** a batch fails with `42P10`
- **THEN** the route returns 409 with code `42P10` and tries no further batch

### Requirement: Per-row fallback after a rejected batch (baseline)

A batch that fails with `23514` SHALL be upserted again one row at a time, once, so one rejected row
cannot stop the good rows beside it.

#### Scenario: Stale card beside good cards
- **WHEN** a queue holds a stale card and two good cards
- **THEN** the good cards land and the stale card's cloud row is unchanged

#### Scenario: Two devices
- **WHEN** a second device has already pushed a later review of a card and this device's unload queue
  still holds the older copy
- **THEN** the older copy is rejected and the later review stays in the cloud

### Requirement: Per-row outcomes decide the response (changed)

After the per-row fallback, a row rejected with `23514` SHALL NOT count as a failure, whether or not
any other row landed. A row failing with a structural error SHALL stop the request and the route SHALL
return 409 with `structural_error` and that SQLSTATE. A row failing any other way, or throwing, SHALL
make the route return 502 with `partial_failure`, and SHALL NOT stop the remaining rows or batches.

#### Scenario: Queue of one stale card
- **WHEN** the only card in the queue is rejected with `23514`
- **THEN** the route returns 200, so the caller clears its queue and shows no "Sync failed" banner

#### Scenario: Transient failure beside a rejection
- **WHEN** a batch falls back to rows, one row lands, one is rejected and one fails with a timeout
- **THEN** the route returns 502, so the caller keeps its queue

#### Scenario: Network error on a row
- **WHEN** a per-row upsert throws
- **THEN** the route returns 502 and logs the failure

#### Scenario: App closed, queue replayed
- **WHEN** the service worker replays a queue after a 502 and the failed row now succeeds
- **THEN** the route returns 200 and the row is in the cloud, with rows that had already landed unharmed

#### Scenario: Structural error on a row
- **WHEN** a row in the fallback fails with `23503`
- **THEN** the route returns 409 with code `23503` and upserts no further row

#### Scenario: Malformed row
- **WHEN** a row breaks a table CHECK, which also raises `23514`
- **THEN** it counts as rejected and the route returns 200

### Requirement: Grade-log leg is best-effort (baseline)

Grade-log entries in the payload SHALL be validated one by one, capped at 200 and upserted without
changing the response status.

#### Scenario: Grade-log upsert fails
- **WHEN** the card leg succeeds and the grade-log upsert fails
- **THEN** the route returns 200
