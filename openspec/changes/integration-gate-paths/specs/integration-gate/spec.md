## Purpose

When the DB-backed integration suite runs for a Poké Memory change, and how `integration-gate` reports
the result, so that a pass means the suite either ran or did not need to.

## ADDED Requirements

### Requirement: A PR on a filtered path runs the suite (baseline, current behaviour)

The `decide` job SHALL set `run=true` on a pull request whose diff matches the `cloud_write` filter.

#### Scenario: PR changes sync code

- **WHEN** a PR changes a file under `lib/sync/**`
- **THEN** the `integration` job runs

### Requirement: The label and a manual dispatch run the suite (baseline, current behaviour)

The `decide` job SHALL set `run=true` on a PR with the `integration-tests` label and on a
`workflow_dispatch` run, whatever the paths.

#### Scenario: Labelled PR outside the filter

- **WHEN** a PR outside the filter carries the `integration-tests` label
- **THEN** the `integration` job runs

#### Scenario: Manual dispatch

- **WHEN** the workflow is dispatched by hand
- **THEN** the `integration` job runs

### Requirement: The gate always reports (baseline, current behaviour)

`integration-gate` SHALL report on every run. It SHALL pass when the suite was not requested or was
skipped, and SHALL fail when a requested suite did not pass. The job name SHALL NOT change, because it
is a required check on `qa-staging`.

#### Scenario: PR outside the filter

- **WHEN** a PR with no label touches only paths outside the filter
- **THEN** `integration` is skipped and `integration-gate` passes

#### Scenario: Dependabot PR

- **WHEN** Dependabot opens a PR
- **THEN** `decide` is skipped and `integration-gate` passes

#### Scenario: A requested suite fails

- **WHEN** `decide` sets `run=true` and `integration` fails
- **THEN** `integration-gate` fails

### Requirement: Sprite-only changes do not start the workflow (baseline, current behaviour)

The workflow SHALL NOT start for a pull request whose diff is confined to `public/sprites/**`.

#### Scenario: Sprite regeneration PR

- **WHEN** a PR changes only files under `public/sprites/**`
- **THEN** the workflow does not start

### Requirement: The workflow holds no secrets (baseline, current behaviour)

The workflow SHALL use no repository secrets and no `pull_request_target` trigger, so a fork PR reaches
nothing privileged.

#### Scenario: Fork PR

- **WHEN** a PR from a fork matches the filter
- **THEN** the suite runs with read-only permissions and no secrets

### Requirement: The filter covers what the suite imports

The `cloud_write` filter SHALL match every first-party path imported directly by a file in
`lib/sync/integration/`, through `from`, `import()` or `vi.mock()`, plus `app/api/push/**` and
`app/api/feedback/**`, whose RPCs the suite pins. A test in the required `test` job SHALL fail, naming the path, when one is missing.

#### Scenario: PR changes the account archive

- **WHEN** a PR changes `lib/storage/userArchive.ts`
- **THEN** the `integration` job runs

#### Scenario: PR changes a push route

- **WHEN** a PR changes `app/api/push/send-streak-nudge/route.ts`
- **THEN** the `integration` job runs

#### Scenario: PR changes the feedback route

- **WHEN** a PR changes `app/api/feedback/route.ts`
- **THEN** the `integration` job runs

#### Scenario: A test starts importing from a new path

- **WHEN** a file in `lib/sync/integration/` imports a first-party path outside the filter
- **THEN** `scripts/integration-gate-paths.test.mjs` fails and names that path

### Requirement: Every code merge to qa runs the suite

The workflow SHALL run the suite on every push to `qa`, whatever the paths, except a push confined to
`public/sprites/**`. A push to any other branch SHALL NOT start it. The result SHALL block nothing
already merged.

#### Scenario: Dependabot bump lands on qa

- **WHEN** a merged Dependabot PR, whose own run skipped the suite, lands on `qa`
- **THEN** the push run executes the suite

#### Scenario: Two merges in quick succession

- **WHEN** a second push reaches `qa` while the first run is in progress
- **THEN** the first run is cancelled and the newer tip is tested
- **AND** the older commit's `integration-gate` may report failure, because a cancelled suite did not pass

#### Scenario: Sprite-only merge

- **WHEN** a push to `qa` changes only files under `public/sprites/**`
- **THEN** the workflow does not start
