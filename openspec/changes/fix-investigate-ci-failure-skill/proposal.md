## Why

`/investigate-ci-failure` has never existed in a Poké Memory session. The skill lives at
`.claude/skills/investigate-ci-failure.md`, but Claude Code only discovers a project skill at
`.claude/skills/<name>/SKILL.md`, so the file has been invisible since it was added on 28 May 2026
(PR #1287). `AGENTS.md:148` and `.claude/commands/batch-issues.md:201,224` tell agents to use it when
CI does not converge, so every such investigation since then fell back to dispatching another sweep
agent, the exact habit the skill exists to replace. Root cause proven on 25 October 2026 (see
`design.md`).

Fixes: poke-memory #1992

## What Changes

- Move `.claude/skills/investigate-ci-failure.md` to `.claude/skills/investigate-ci-failure/SKILL.md`
  with `git mv`. The content, frontmatter (`name`, `description`, `allowed-tools`) and body stay
  byte for byte the same.
- `.claude/commands/batch-issues.md:224`: "Hand off to `.claude/skills/investigate-ci-failure.md`"
  becomes "Hand off to `/investigate-ci-failure`", so it no longer names a path that will not exist.
- New check `npm run lint:skills-layout` (`scripts/check-skills-layout.mjs`, pure helper in
  `scripts/lib/skills-layout.mjs` with `scripts/lib/skills-layout.test.mjs`): fails, naming the
  path, when `.claude/skills/` holds a file at its top level or a folder with no `SKILL.md`. Wired
  into the `lint` chain and, so a skill-only PR (all Markdown, which skips the `test` job) is still
  checked, run as one extra step in `ci.yml`'s always-run `em-dash` job (open call, see
  Clarifications).

## Also touches

Filled with the `blast-radius` skill on 25 October 2026. Evidence for each line is in `design.md`.

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because nothing under `app/`, `components/` or `lib/` changes.
- **Guest mode (localStorage):** no change, because no app code changes.
- **Cloud sync and Supabase migrations (both projects):** no change, because no app code or migration changes.
- **Superuser mode and QA-seed scenarios:** no change, because no app code or seed script changes.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy or message catalogue changes.
- **Push notifications and the service worker (offline):** no change, because no app code changes.
- **Sign-in:** no change, because no app code changes.
- **Privacy notice and sub-processors:** no change, because no data flow changes.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because `changelog-gate.yml` asks for one only when `app/**`, `components/**` or `lib/**` change, and this is internal agent tooling. Vercel skips the preview build (`scripts/vercel-ignored-build.sh:39` ignores `.claude/`).
- **CI and GitHub Actions:** `ci.yml` gains one step in the `em-dash` job (`npm run lint:skills-layout`), and the `lint` chain in `package.json` gains the new script. That workflow edit needs a `workflow-expert` review (WORKFLOW.md). No other workflow changes. `scripts/check-playwright-pin.mjs` scans every tracked `.md`, so the Playwright tag inside the skill is still checked at its new path (proven, see `design.md`).
- **Agent tooling (not on the house list, added because it is the surface that changes):** `/investigate-ci-failure` becomes listed and invocable. `/batch-issues`, `/ship`, the `/opsx:*` commands and the `openspec-*` skills load exactly as before. ESLint ignores `.claude/**` and the context budget (`.github/context-budget.txt`) covers only `AGENTS.md`, `CLAUDE.md` and `.claude/agents/*.md`, so neither sees the move.

## Removes

- The stale path reference `.claude/skills/investigate-ci-failure.md` in `batch-issues.md:224`.
- The flat file layout itself: after this change no file sits at the top level of `.claude/skills/`,
  and the new lint keeps it that way. No code, setting or requirement becomes unnecessary, because
  the skill's content is kept as it is.

## Out of scope

- Changing what the skill says. The issue notes its procedure has never run against a real
  non-converging CI failure; that live exercise is a check after the move (task 4.1 moves it to an
  issue), not part of this fix.
- Other repos: the root-cause search found no other flat skill file in any Frazzled-Productions repo,
  so no shared lint in `Frazzled-Productions/.github` is proposed here (open call, see
  Clarifications).
- A retro note on the five months the skill was invisible (the issue suggests one; that is a
  `/retro` item, not code).

## Owner decisions relied on

- 21 October 2026: every change, bug fixes included, goes through OpenSpec (`openspec/config.yaml`).
- 23 October 2026: run `root-cause` before grilling on every bug and `blast-radius` when writing every
  proposal (ops `research/pstack-review-2026-10-23.md`).
- 25 October 2026: overnight spend run with broad approval to prepare work; this proposal is not
  approved yet and waits for Fraser's review.

## Clarifications

Open calls for Fraser's review (grilling happens at review); each has a recommended answer.

- 2026-10-25 Q: Fix by moving the file into `investigate-ci-failure/SKILL.md` (the issue's fix), or by turning it into a command under `.claude/commands/` (flat files load there)? Recommended: move it to `SKILL.md`, because the name, the `allowed-tools` frontmatter and every reference already treat it as a skill. A: open.
- 2026-10-25 Q: Add the `lint:skills-layout` check at all, or just move the file? Recommended: add it; it costs no model call and would have caught PR #1287 at review. A: open.
- 2026-10-25 Q: Run the check only in the `lint` chain (skipped on Markdown-only PRs, so caught on the next code PR, as the Playwright pin check is), or also as one step in the always-run `em-dash` job? Recommended: both, because a new skill PR is typically Markdown-only, the exact case the `lint` chain skips. A: open.
- 2026-10-25 Q: Put the check in this repo now, or in the shared `Frazzled-Productions/.github` tooling for every repo? Recommended: this repo now; no other repo has the fault today, and it can move to shared tooling later if a second repo needs it. A: open.
- 2026-10-25 Q: Close #1992 on the move plus a one-turn discovery check, or keep it open until the skill has run against a real non-converging CI failure (the issue's own ask)? Recommended: close on the move and discovery check, and file the live exercise as its own issue (task 4.1), so the build PR can carry `Closes #1992`. A: open.
