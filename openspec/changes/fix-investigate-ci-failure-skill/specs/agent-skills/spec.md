## Purpose

How Poké Memory's project commands and skills for Claude Code are laid out under `.claude/`, so that
each one the docs name loads in a session: commands are flat files under `.claude/commands/`, every
skill is a folder holding `SKILL.md` under `.claude/skills/`, and a lint keeps that layout.

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
`.claude/skills/investigate-ci-failure/SKILL.md` with its body, `name` and `description` unchanged,
and SHALL load as `/investigate-ci-failure`. Its `allowed-tools` line SHALL be unchanged unless the
owner chooses to narrow it (open call in the proposal), in which case it SHALL list only the
narrowed tools.

#### Scenario: The CI investigation skill loads

- **WHEN** a session in the repo is sent `/investigate-ci-failure`
- **THEN** the transcript records "Base directory for this skill: .../.claude/skills/investigate-ci-failure" followed by the skill body, not `unknown_command_fallback`

#### Scenario: Named from batch-issues

- **WHEN** `/batch-issues` reaches a batch PR still red after one fix round
- **THEN** its instruction names `/investigate-ci-failure`, which exists, rather than a file path

#### Scenario: Content kept

- **WHEN** the moved `SKILL.md` is compared with the old flat file
- **THEN** `git diff -M` shows a rename whose only changed line, if any, is `allowed-tools`

#### Scenario: Playwright pin still checked at the new path

- **WHEN** the moved `SKILL.md` holds a Playwright image tag that differs from the version in `package-lock.json`
- **THEN** `npm run lint:playwright-pin` exits non-zero naming `.claude/skills/investigate-ci-failure/SKILL.md`

### Requirement: A layout check rejects skills that would not load

`npm run lint:skills-layout` SHALL fail, naming each path, when the git-tracked files under
`.claude/skills/` include a file at its top level or a folder without `SKILL.md`, and SHALL pass
otherwise. It SHALL ignore untracked files and SHALL make no model call. It SHALL run in the
`lint` chain, which the required `test` job runs.

#### Scenario: Flat skill file

- **WHEN** `.claude/skills/` holds `investigate-ci-failure.md` at its top level
- **THEN** the check exits non-zero and names `.claude/skills/investigate-ci-failure.md`

#### Scenario: Folder with no SKILL.md

- **WHEN** `.claude/skills/new-skill/` holds only `README.md`
- **THEN** the check exits non-zero and names `.claude/skills/new-skill/`

#### Scenario: Correct layout

- **WHEN** every entry in `.claude/skills/` is a folder holding `SKILL.md`
- **THEN** the check exits 0

#### Scenario: Untracked file ignored

- **WHEN** an untracked `.DS_Store` sits at the top level of `.claude/skills/` and every tracked entry is a folder holding `SKILL.md`
- **THEN** the check exits 0
