## Purpose
How Poké Memory's OpenSpec archive job moves merged changes into the main specs on qa. The tools live in
Frazzled-Productions/.github; this records what this repo relies on. The first three requirements are
the baseline of today's behaviour, taken from `openspec-archive.yml` and `tools/openspec/archive.py` at
`v1` (v1.9.0, spec on touch).

## ADDED Requirements

### Requirement: Archive changes in name order
The archive job SHALL archive each active change in name order, one commit each, and open one pull
request into qa that auto-merges once the required checks pass.

#### Scenario: Two built changes
- **WHEN** two active changes on qa have every task ticked
- **THEN** the job archives both, in name order, in one pull request into qa

#### Scenario: Nothing to archive
- **WHEN** qa has no active change
- **THEN** the job exits successfully and opens no pull request

### Requirement: Any failure lands nothing
The archive job SHALL land nothing from a run in which a change fails to archive or fails the checks,
and SHALL open or comment on an issue labelled `openspec` with the failing output.

#### Scenario: A change fails
- **WHEN** an earlier change archives and a later one fails
- **THEN** neither lands and the issue names the failing change

### Requirement: Archive diff stays under openspec
The archive job SHALL refuse a run whose changes reach outside plain files under `openspec/`.

#### Scenario: A file outside openspec is modified
- **WHEN** the working tree shows a change to a file outside `openspec/`
- **THEN** the run fails and nothing lands

### Requirement: Skip changes not yet started
With `skip-not-started` set, the archive job SHALL leave in place each change that has at least one task
and none ticked, SHALL name it in the run log, and SHALL NOT fail because of it. Poké Memory's caller sets
this input.

#### Scenario: A proposal waits for its build
- **WHEN** a change on qa has 0 of 11 tasks ticked and a built change follows it in name order
- **THEN** the proposal stays active, the built change archives and the run log names the proposal

#### Scenario: The build merges
- **WHEN** the build pull request ticks every task of a skipped change and merges to qa
- **THEN** the next run archives that change

#### Scenario: A build merged with a task open
- **WHEN** a change has 7 of 9 tasks ticked
- **THEN** the job tries to archive it, the run fails and an issue names it

#### Scenario: A build merged with no task ticked
- **WHEN** a build merges to qa with 0 of 9 tasks ticked
- **THEN** the job treats it as not started and the run log names it, a known limit of this rule

#### Scenario: A change with no tasks file
- **WHEN** a change has no tasks
- **THEN** it is not skipped and behaves as it did before this input

#### Scenario: The task counts cannot be read
- **WHEN** `skip-not-started` is set and `openspec list --json` fails
- **THEN** the run fails, an issue is opened and nothing lands

#### Scenario: The overlap check is not told about the skip
- **WHEN** a built change modifies a capability that a skipped change creates
- **THEN** `archive.py simulate` in the OpenSpec overlap check still passes while the archive job fails
  with "target spec does not exist", a known limit of this rule (owner ruling, 6 November 2026)

#### Scenario: A caller without the input
- **WHEN** a caller does not set `skip-not-started`
- **THEN** a change with no ticked task fails the run, as before

### Requirement: Titles stay within GitHub's limit
When the change names would make a title over 200 characters, the archive job SHALL use a short title
giving the count for the pull request and for any failure issue, and SHALL keep the full list in the body.

#### Scenario: A large run opens its pull request
- **WHEN** a run archives 40 changes and no archive pull request is open
- **THEN** the pull request opens with the short title and its body lists all 40

#### Scenario: A large run fails after the build
- **WHEN** a run archiving 40 changes fails after the build, at the push or later
- **THEN** the failure issue opens with a short title and nothing lands
