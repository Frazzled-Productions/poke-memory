## MODIFIED Requirements

### Requirement: Legacy cache removal and what stays after sign-out (baseline)

Activating a worker SHALL delete `poke-memory-sprites-v2` and `poke-memory-cries-v2`, and do nothing when
`caches` is absent. Sign-out SHALL NOT clear any cache or the offline pack. No code deletes buckets
orphaned by a future `SW_CACHE_VERSION` bump.

#### Scenario: Sign-out

- **WHEN** a player signs out
- **THEN** only the session ends; Cache Storage and the `offline-pack` store are unchanged

Source: `app/sw.ts:849`, `app/sw.ts:854`, `lib/pwa/cacheStrategy.ts:102`, planned `lib/auth/actions.ts`.

### Requirement: Reading CHANGELOG.md (baseline)

`parseChangelog` SHALL accept `## [X.Y.Z] - YYYY-MM-DD` (hyphen or legacy em dash) and end a release
at any other `## ` heading, keeping the six known `###` kinds in canonical order, merging repeats,
dropping `Internal:` bullets and empty releases. `getChangelog` SHALL read a module generated from
`CHANGELOG.md` at build time (the Worker has no file system), returning an empty list if it was missing.

#### Scenario: Wrapped bullet

- **WHEN** a line indented by exactly two spaces follows a bullet
- **THEN** it extends the bullet, a blank line ends it, and an unindented prose line does not end it,
  contrary to the comment (#2326)

#### Scenario: Other indents

- **WHEN** a line with four spaces or a tab follows a bullet, or a two-space `- ` line does
- **THEN** the four-space or tab line is dropped and the bullet stays open, and the two-space `- ` line
  is folded into the bullet as ` - text` rather than kept as a sub-bullet

#### Scenario: Internal-only release

- **WHEN** a release has only `Internal:` bullets
- **THEN** it does not appear

#### Scenario: File missing

- **WHEN** `CHANGELOG.md` is missing when the module is generated
- **THEN** the page shows its empty message, not a 500

#### Scenario: Release after a deploy

- **WHEN** a release adds a section to `CHANGELOG.md` and the Worker is rebuilt and deployed
- **THEN** What's new shows the new section, with the same content the file read gave

Source: `lib/changelog/parse.ts:33`, `lib/changelog/parse.ts:36`, `lib/changelog/parse.ts:52`, `lib/changelog/parse.ts:74`, `lib/changelog/parse.ts:92`, `lib/changelog/parse.ts:105`, `lib/changelog/parse.ts:110`, `lib/changelog/parse.ts:114`, `lib/changelog/parse.ts:139`, `lib/changelog/parse.ts:145`, `lib/changelog/parse.ts:150`, `lib/changelog/parse.test.ts:99`, `lib/changelog/parse.test.ts:255`; planned `scripts/generate-changelog-module.mjs`.
