## Root cause

Proven on 25 October 2026 with Claude Code 2.1.310 (`root-cause` skill, overnight spend run
2026-10-25-2).

**Claude Code does not load `.claude/skills/investigate-ci-failure.md` because a project skill must be
a folder holding `SKILL.md`.** The same bytes at `.claude/skills/investigate-ci-failure/SKILL.md`
load and run.

- Repro: two scratch git repos, each holding the file from `origin/qa` byte for byte, one flat
  (`.claude/skills/investigate-ci-failure.md`) and one as `investigate-ci-failure/SKILL.md`. In each,
  `claude -p "/investigate-ci-failure" --max-turns 1 --tools ""`.
  - Flat: the transcript records `unknown_command_fallback` for `investigate-ci-failure`, and the
    model replies that the command "isn't installed in this session".
  - Folder: the transcript records `<command-name>/investigate-ci-failure</command-name>` and "Base
    directory for this skill: .../investigate-ci-failure", then the skill body. The skill ran.
- Hypotheses ruled out: invalid frontmatter (the identical frontmatter loads in the folder layout);
  repo settings disabling skills (the scratch repos have no settings and show the same split).
- First wrong step: issue #1269's acceptance criterion asked for "New skill file
  `.claude/skills/investigate-ci-failure.md`", and PR #1287 (commit `040bd2c0`, 28 May 2026) checked
  only that the frontmatter parsed "against `.claude/commands/batch-issues.md` which uses the same
  shape". Flat `<name>.md` is valid for commands, not skills, and the skill was never invoked. The
  path has not changed since (`git log --follow`).
- Same fault elsewhere: none. A search of `.claude/skills/` and `.agents/skills/` on the default
  branch of every repo under `~/Projects/frazzled-productions/` found no other flat skill file.

## Baseline (current behaviour, before this change)

Written from the tree on `origin/qa` at `8137a963`:

- `.claude/commands/batch-issues.md`, `.claude/commands/ship.md` and `.claude/commands/opsx/*.md`
  are flat files and load as `/batch-issues`, `/ship` and `/opsx:*`.
- The seven `openspec-*` skills are folders with `SKILL.md` and load.
- `.claude/skills/investigate-ci-failure.md` is the only top-level file in `.claude/skills/`, and it
  does not load.
- Nothing checks the layout of `.claude/skills/`.

The delta spec records the first three as baseline requirements and adds the fix.

## Decisions

- **Move, not a command.** The issue (#1992) gives the move as the fix, and the name, the
  `allowed-tools` frontmatter and every reference already treat it as a skill. (Was an open call;
  dropped 2026-10-26 as settled.)
- **Move, do not rewrite.** `git mv` keeps the file's history (`git log --follow`) and leaves its
  body untouched, so nothing about what the skill says changes. The only frontmatter edit is the
  `allowed-tools` line, narrowed to `[Bash(gh *), Bash(git *), Bash(npx playwright *), Bash(npm run *), Read, Grep, Glob]`
  (Fraser, 26 October 2026).
- **Reference by slash name.** `batch-issues.md:224` becomes `/investigate-ci-failure`, matching
  `AGENTS.md:148` and `batch-issues.md:201`, so a future move cannot leave a stale path.
- **Layout lint, no model call.** `scripts/lib/skills-layout.mjs` exports a pure function that takes
  the entries of `.claude/skills/` and returns the offending paths (a top-level file, or a folder
  with no `SKILL.md`). `scripts/check-skills-layout.mjs` lists the tracked files with
  `git ls-files -z .claude/skills` (as `scripts/check-playwright-pin.mjs` does in `listTracked`), so
  a Finder `.DS_Store` or an untracked scratch file cannot fail `npm run lint` on a Mac while CI
  stays green, and fails with each path named. Same shape as the Playwright pin check (`scripts/check-playwright-pin.mjs` with
  `scripts/lib/playwright-pin.mjs`), so it is picked up by the existing `scripts/**/*.test.mjs`
  Vitest project. Placement: the `lint` chain, which the required `test` job runs, and `'.claude/skills/**'`
  re-included in `ci.yml`'s `code` filter (Fraser, 26 October 2026); no `em-dash` job step,
  because `em-dash` is not a required check on `qa`.

## Blast radius (25 October 2026)

**The one fact it is safe because of:** the only thing that reads the skill by its file path is the
one sentence in `batch-issues.md:224`; every tool that scans the file reads it by extension or by
folder, and keeps working at the new path.

Rung reached: 4 (ran it against the real code), then 5 (ran the real Claude Code session in this
repo).

- Playwright pin check, run in the worktree with the file moved:
  `node scripts/check-playwright-pin.mjs` printed "OK" before and after the move (exit 0). With the
  tag in the moved file changed to one minor behind the lock, it failed naming
  `.claude/skills/investigate-ci-failure/SKILL.md:42` as a drifted pin (exit 1), so the check still
  covers the skill. (The exact error text is not quoted here, because this file is tracked and the
  same check would flag the quote.)
- Discovery, run in this repo with the file moved:
  `claude -p "/investigate-ci-failure" --max-turns 1 --tools ""` (session
  `32158e6f-76d2-49e1-b585-3951a5ad9bfb`) recorded `<command-name>/investigate-ci-failure</command-name>`
  and "Base directory for this skill: .../proposal-fix-1992/.claude/skills/investigate-ci-failure".
  The trial move was then reverted; this PR holds only the proposal.

Cleared:

- Path references: `git grep investigate-ci-failure` finds only `AGENTS.md:148` and
  `batch-issues.md:201` (slash name, fine) and `batch-issues.md:224` (path, changed here).
- ESLint ignores `.claude/**` (`eslint.config.mjs:19`).
- Context budget covers `AGENTS.md`, `CLAUDE.md` and `GLOB:.claude/agents/*.md` only
  (`.github/context-budget.txt`).
- Em-dash lint scans the file by content wherever it is; the skill already passes it on `qa`.
- CI `code` filter (`ci.yml:41-48`): corrected 2026-10-26. The comment above the filter says `'**'`
  plus `!` exclusions means "any file except these", but `ci.yml` sets no `predicate-quantifier`,
  and `dorny/paths-filter` defaults to `some`, where a file counts if any one pattern matches, so
  `'**'` matches every file. This PR's own `changes` job (run 40229453529) reported
  `Filter code = true` for its five `.md` files. So today every PR runs `test` and the `lint` chain,
  and the build PR does too. The broken fast path is an existing bug, not fixed here (filed as #2200).
- The build PR edits `ci.yml` for the `code` filter re-include; `ci.yml` is in
  `e2e_relevant`, so `e2e` then runs on the build PR (CI time only).
- Required checks on `qa` (ruleset qa-staging): `test`, `e2e`, `Test coverage report`,
  `integration-gate`, `changelog-gate`, `i18n-leak`, `OpenSpec required`, `Context budget`.
  `em-dash` is not among them, so a step there is advisory.
- Changelog gate: only `app/**`, `components/**`, `lib/**` need a fragment.
- Vercel: `scripts/vercel-ignored-build.sh:39` skips `.claude/` changes.
- `openspec update` regenerates only the `openspec-*` skill folders and `opsx` commands; it does not
  touch `investigate-ci-failure/`.

Risks:

- The skill now runs for real, and its procedure has never been exercised (the issue's own warning).
  Where: `.claude/skills/investigate-ci-failure/SKILL.md`. Likelihood: medium that some step is
  stale; cost: low, it is guidance for an agent.
  Cheapest check: one live run on the next non-converging CI failure (task 4.1, moved to #2199).
- The skill's `allowed-tools` (unscoped `Bash`, `Edit`, `Agent` and others) are approved without a
  prompt while the skill is active (Claude Code skills docs; cited, not run here), which is wider
  than `.claude/settings.json`'s allow-list. Where: the skill's frontmatter. Likelihood: certain
  once it loads; cost: an agent in the skill can run any shell command or edit unprompted. Fixed
  in this change: the list is narrowed (Fraser, 26 October 2026).
- Once the docs fast path is fixed, a skill-only PR would skip the `lint` chain. Covered by
  `'.claude/skills/**'`, re-included in the `code` filter in this change; #2200 must keep that
  re-include working when it sets a `predicate-quantifier`.

Before merge, the cheapest test that would catch the real bug: `scripts/lib/skills-layout.test.mjs`
fed today's `.claude/skills/` entries must report `investigate-ci-failure.md` (task 1.1, red first).
