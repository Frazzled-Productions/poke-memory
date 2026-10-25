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

- **Move, do not rewrite.** `git mv` keeps the file's history (`git log --follow`) and leaves its
  content untouched, so nothing about how the skill behaves changes except that it now loads.
- **Reference by slash name.** `batch-issues.md:224` becomes `/investigate-ci-failure`, matching
  `AGENTS.md:148` and `batch-issues.md:201`, so a future move cannot leave a stale path.
- **Layout lint, no model call.** `scripts/lib/skills-layout.mjs` exports a pure function that takes
  the entries of `.claude/skills/` and returns the offending paths (a top-level file, or a folder
  with no `SKILL.md`). `scripts/check-skills-layout.mjs` reads the folder and fails with each path
  named. Same shape as the Playwright pin check (`scripts/check-playwright-pin.mjs` with
  `scripts/lib/playwright-pin.mjs`), so it is picked up by the existing `scripts/**/*.test.mjs`
  Vitest project. Recommended placement (open call in the proposal): the `lint` chain plus one step
  in `ci.yml`'s always-run `em-dash` job.

## Blast radius (25 October 2026)

**The one fact it is safe because of:** the only thing that reads the skill by its file path is the
one sentence in `batch-issues.md:224`; every tool that scans the file reads it by extension or by
folder, and keeps working at the new path.

Rung reached: 4 (ran it against the real code), then 5 (ran the real Claude Code session in this
repo).

- Playwright pin check, run in the worktree with the file moved:
  `node scripts/check-playwright-pin.mjs` printed "OK" before and after the move (exit 0). With the
  tag in the moved file changed to `v1.62.0` it failed with
  `.claude/skills/investigate-ci-failure/SKILL.md:42 pins playwright:v1.62.0, but package-lock.json locks @playwright/test 1.63.0`
  (exit 1), so the check still covers the skill.
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
- CI `code` filter (`ci.yml:41-48`): a Markdown move alone skips the `test` job; the new script and
  `package.json` edit make the build PR a code PR, so the full lint chain runs on it.
- Changelog gate: only `app/**`, `components/**`, `lib/**` need a fragment.
- Vercel: `scripts/vercel-ignored-build.sh:39` skips `.claude/` changes.
- `openspec update` regenerates only the `openspec-*` skill folders and `opsx` commands; it does not
  touch `investigate-ci-failure/`.

Risks:

- The skill now runs for real, and its procedure has never been exercised (the issue's own warning).
  Where: `.claude/skills/investigate-ci-failure/SKILL.md`. Likelihood: medium that some step is
  stale; cost: low, it is guidance for an agent, and its `allowed-tools` are the same as any agent's.
  Cheapest check: one live run on the next non-converging CI failure (task 4.1, moved to an issue).
- A later skill PR that is Markdown-only skips the `lint` chain. Covered only if the check also runs
  in the always-run `em-dash` job (open call).

Before merge, the cheapest test that would catch the real bug: `scripts/lib/skills-layout.test.mjs`
fed today's `.claude/skills/` entries must report `investigate-ci-failure.md` (task 2.1, red first).
