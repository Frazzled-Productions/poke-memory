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
  with `git mv`. The body, `name` and `description` stay the same. The `allowed-tools` line is
  narrowed to `[Bash(gh *), Bash(git *), Bash(npx playwright *), Bash(npm run *), Read, Grep, Glob]`
  (Fraser, 26 October 2026): in a skill that field approves the listed tools without a prompt while
  the skill is active, and unscoped `Bash` and `Edit` were wider than the repo allow-list in
  `.claude/settings.json`.
- `.claude/commands/batch-issues.md:224`: "Hand off to `.claude/skills/investigate-ci-failure.md`"
  becomes "Hand off to `/investigate-ci-failure`", so it no longer names a path that will not exist.
- New check `npm run lint:skills-layout` (`scripts/check-skills-layout.mjs`, pure helper in
  `scripts/lib/skills-layout.mjs` with `scripts/lib/skills-layout.test.mjs`): fails, naming the
  path, when the tracked files under `.claude/skills/` (from `git ls-files`, so an untracked
  `.DS_Store` or scratch file is ignored) include a file at its top level or a folder with no
  `SKILL.md`. Wired into the `lint` chain, which the required `test` job runs.
- Add `'.claude/skills/**'` as a re-include in `ci.yml`'s `code` filter (Fraser, 26 October 2026),
  so a skill-only PR still runs the `test` job once the docs fast path works again. Today it makes
  no difference, because the fast path is broken and every PR, docs-only included, runs `test`
  (see "CI and GitHub Actions" below).

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
- **CI and GitHub Actions:** the `lint` chain in `package.json` gains the new script. `ci.yml` gains one line, the `code` filter re-include, which needs a `workflow-expert` review (WORKFLOW.md); because `ci.yml` is in the `e2e_relevant` filter, the build PR also runs `e2e` (CI time only). `WORKFLOW.md`'s `ci.yml` row gains one clause naming the re-include, per its update rule. The `workflow-expert` review found the line inert today and found that it cannot survive a `predicate-quantifier: every` fix as written; that is recorded on #2200. No em-dash job step. `scripts/check-playwright-pin.mjs` scans every tracked `.md`, so the Playwright tag inside the skill is still checked at its new path (proven, see `design.md`). Found while checking this: the docs-only fast path in `ci.yml` is broken today (no `predicate-quantifier: every`, so `'**'` matches every file and the `!` exclusions never apply; this PR's own `changes` job reported `code = true` for five `.md` files). That is an existing bug with its own CI blast radius, so it is not fixed here (filed as #2200).
- **Claude Code permissions (`.claude/settings.json` allow-list):** once the skill loads, its `allowed-tools` (`Bash`, `Edit`, `Agent` and others, unscoped) are approved without a prompt while it is active, which is wider than the repo allow-list (`Bash(git *)`, `Bash(gh pr *)`, `Bash(npm run *)` and similar). `settings.json` itself does not change; the skill's own list is narrowed to scoped `Bash(gh *)`, `Bash(git *)`, `Bash(npx playwright *)`, `Bash(npm run *)` plus `Read`, `Grep` and `Glob`, so `Edit`, `Agent` and any other shell command prompt as usual.
- **Spike PR #2181 (draft, the build tried early):** held the move, the lint (with `git ls-files`) and the `batch-issues.md` edit. The build PR starts from it, adds the `ci.yml` re-include and the narrowed `allowed-tools`, and supersedes it.
- **Agent tooling (not on the house list, added because it is the surface that changes):** `/investigate-ci-failure` becomes listed and invocable. `/batch-issues`, `/ship`, the `/opsx:*` commands and the `openspec-*` skills load exactly as before. ESLint ignores `.claude/**` and the context budget (`.github/context-budget.txt`) covers only `AGENTS.md`, `CLAUDE.md` and `.claude/agents/*.md`, so neither sees the move.

## Removes

- The stale path reference `.claude/skills/investigate-ci-failure.md` in `batch-issues.md:224`.
- The flat file layout itself: after this change no file sits at the top level of `.claude/skills/`,
  and the new lint keeps it that way. No code, setting or requirement becomes unnecessary, because
  the skill's content is kept as it is.

## Out of scope

- Changing what the skill says. The issue notes its procedure has never run against a real
  non-converging CI failure; that live exercise is a check after the move (task 4.1, moved to
  #2199), not part of this fix.
- Other repos: the root-cause search found no other flat skill file in any Frazzled-Productions repo,
  so no shared lint in `Frazzled-Productions/.github` is proposed here (Fraser, 26 October 2026).
- A retro note on the five months the skill was invisible (the issue suggests one; that is a
  `/retro` item, not code).

## Owner decisions relied on

- 21 October 2026: every change, bug fixes included, goes through OpenSpec (`openspec/config.yaml`).
- 23 October 2026: run `root-cause` before grilling on every bug and `blast-radius` when writing every
  proposal (ops `research/pstack-review-2026-10-23.md`).
- 25 October 2026: overnight spend run with broad approval to prepare work.
- 26 October 2026: Fraser approved this proposal (walked through in chat), every open call taking its
  recommended answer (Clarifications).

## Clarifications

Open calls for Fraser's review (grilling happens at review); each had a recommended answer, and
Fraser's answers on 26 October 2026 follow the list.

- 2026-10-25 Q: Add the `lint:skills-layout` check at all, or just move the file? Recommended: add it; it costs no model call and would have caught PR #1287 at review. A: answered 2026-10-26, below.
- 2026-10-25 Q (reworded 2026-10-26, recommendation changed): Run the check only in the `lint` chain, or also as a step in the always-run `em-dash` job? Recommended: the `lint` chain only, plus `'.claude/skills/**'` as a re-include in `ci.yml`'s `code` filter. Today every PR, docs-only included, runs `npm run lint` in the required `test` job (the fast path is broken), and `em-dash` is not a required check on `qa`, so a red step there would not block a merge. The re-include keeps skill PRs covered once the fast path is fixed. A: answered 2026-10-26, below.
- 2026-10-25 Q: Put the check in this repo now, or in the shared `Frazzled-Productions/.github` tooling for every repo? Recommended: this repo now; no other repo has the fault today, and it can move to shared tooling later if a second repo needs it. A: answered 2026-10-26, below.
- 2026-10-25 Q: Close #1992 on the move plus a one-turn discovery check, or keep it open until the skill has run against a real non-converging CI failure (the issue's own ask, "do not close on the file move alone")? Recommended: close on the move and discovery check, and file the live exercise as its own issue (task 4.1), so the build PR can carry `Closes #1992`. A: answered 2026-10-26, below.
- 2026-10-26 Q (added after review): Once the skill loads, its `allowed-tools: [Bash, Read, Edit, Grep, Glob, Agent, TaskCreate, TaskUpdate, TaskList]` lets the agent run any Bash command and edit any file without a prompt while the skill is active, wider than `.claude/settings.json`'s allow-list. Keep it, narrow it (for example `Bash(gh *)`, `Bash(git *)`, `Bash(npx playwright *)`, `Bash(npm run *)`, plus `Read`, `Grep`, `Glob`), or drop the field? Recommended: narrow it in this change; the skill investigates, so it rarely needs unprompted `Edit`. That ends "byte for byte unchanged" for the frontmatter, and the "Frontmatter kept" scenario says so. A: answered 2026-10-26, below.
- 2026-10-26 Q (added after review): The CI docs-only fast path is broken (`ci.yml` `code` filter has no `predicate-quantifier: every`, so every PR counts as code). File it as its own issue, or fix it in this change? Recommended: file it as its own issue, because it changes which PRs run the full build and needs its own blast radius. A: answered 2026-10-26, below.
- Dropped 2026-10-26: "move to `SKILL.md`, or turn it into a command?" was settled by the issue itself (#1992 gives the move as the fix) and every reference already calls it a skill; it is now a Decision in `design.md`.
- Revised 2026-10-26 after independent review: reworded the quoted Playwright error in `design.md` so the required `test` check no longer fails on it; corrected the false "a Markdown move skips `test`" premise (the fast path is broken) and flipped call 3's recommendation; dropped the "Markdown-only PR" scenario, whose advisory `em-dash` step could not fail a PR; the lint now reads `git ls-files`, so untracked files cannot fail it locally; added the `allowed-tools` permission widening to "Also touches" and as a call; added a call for the broken fast path; added a pin-check scenario; made the spec Purpose describe the capability, not the bug; dropped the settled move-or-command call.
- 2026-10-26 Q: Add the `lint:skills-layout` check at all, or just move the file? A: add it (Fraser, in chat).
- 2026-10-26 Q: Run the check only in the `lint` chain, or also in the `em-dash` job? A: the `lint` chain only, plus `'.claude/skills/**'` re-included in `ci.yml`'s `code` filter; no `em-dash` step (Fraser, in chat).
- 2026-10-26 Q: This repo now, or the shared `Frazzled-Productions/.github` tooling? A: this repo now (Fraser, in chat).
- 2026-10-26 Q: Close #1992 on the move plus a discovery check, or keep it open until a live run? A: close on the move and the discovery check; the live exercise is its own issue, #2199 (Fraser, in chat).
- 2026-10-26 Q: Keep, narrow or drop the skill's `allowed-tools`? A: narrow it in this change, to `[Bash(gh *), Bash(git *), Bash(npx playwright *), Bash(npm run *), Read, Grep, Glob]` (Fraser, in chat).
- 2026-10-26 Q: File the broken CI docs-only fast path as its own issue, or fix it here? A: its own issue, #2200 (Fraser, in chat).
