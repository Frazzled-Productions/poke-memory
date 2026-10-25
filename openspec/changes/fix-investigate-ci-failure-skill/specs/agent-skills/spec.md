## Purpose

How Poké Memory's project commands and skills for Claude Code are laid out under `.claude/`, so that
each one the docs name loads in a session. The baseline (current behaviour before this change) is
that commands are flat files and the `openspec-*` skills are folders, while
`investigate-ci-failure` is a flat file in `.claude/skills/` and does not load (#1992).

## ADDED Requirements

### Requirement: Commands load from flat files (baseline, current behaviour)

Each project command SHALL be a flat Markdown file under `.claude/commands/` (`batch-issues.md`,
`ship.md`, `opsx/<name>.md`) and SHALL load as its slash command (`/batch-issues`, `/ship`,
`/opsx:<name>`).

#### Scenario: Batch command still loads

- **WHEN** a Claude Code session in the repo is sent `/batch-issues`
- **THEN** the command loads from `.claude/commands/batch-issues.md`, as before this change

#### Scenario: OpenSpec commands still load

- **WHEN** a session is sent `/opsx:propose`
- **THEN** it loads from `.claude/commands/opsx/propose.md`, as before this change

### Requirement: The OpenSpec skills load from their folders (baseline, current behaviour)

Each `openspec-*` skill SHALL be a folder under `.claude/skills/` holding `SKILL.md`, as written by
`openspec update`, and SHALL load under its folder name.

#### Scenario: OpenSpec skill unchanged

- **WHEN** a session lists its skills
- **THEN** `openspec-propose` and the other six `openspec-*` skills are listed, as before this change

### Requirement: Every project skill is a folder holding SKILL.md

Each project skill SHALL live at `.claude/skills/<name>/SKILL.md`, where `<name>` is the slash name
the docs use. `investigate-ci-failure` SHALL live at
`.claude/skills/investigate-ci-failure/SKILL.md` with its frontmatter (`name`, `description`,
`allowed-tools`) and body unchanged, and SHALL load as `/investigate-ci-failure`.

#### Scenario: The CI investigation skill loads

- **WHEN** a session in the repo is sent `/investigate-ci-failure`
- **THEN** the transcript records "Base directory for this skill: .../.claude/skills/investigate-ci-failure" followed by the skill body, not `unknown_command_fallback`

#### Scenario: Named from batch-issues

- **WHEN** `/batch-issues` reaches a batch PR still red after one fix round
- **THEN** its instruction names `/investigate-ci-failure`, which exists, rather than a file path

#### Scenario: Frontmatter kept

- **WHEN** the moved `SKILL.md` is compared with the old flat file
- **THEN** the content is byte for byte the same (`git diff -M --stat` shows a 100% rename)

### Requirement: A layout check rejects skills that would not load

`npm run lint:skills-layout` SHALL fail, naming each path, when `.claude/skills/` holds a file at its
top level or a folder without `SKILL.md`, and SHALL pass otherwise. It SHALL make no model call.

#### Scenario: Flat skill file

- **WHEN** `.claude/skills/` holds `investigate-ci-failure.md` at its top level
- **THEN** the check exits non-zero and names `.claude/skills/investigate-ci-failure.md`

#### Scenario: Folder with no SKILL.md

- **WHEN** `.claude/skills/new-skill/` holds only `README.md`
- **THEN** the check exits non-zero and names `.claude/skills/new-skill/`

#### Scenario: Correct layout

- **WHEN** every entry in `.claude/skills/` is a folder holding `SKILL.md`
- **THEN** the check exits 0

#### Scenario: Markdown-only PR

- **WHEN** a PR adds only a flat `.md` file to `.claude/skills/` (so the `test` job's `code` filter skips the `lint` chain)
- **THEN** the always-run `em-dash` job's `lint:skills-layout` step fails the PR
