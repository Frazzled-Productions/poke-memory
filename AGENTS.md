# poke-memory

An Anki-style spaced-repetition app for learning Pokémon names and evolutions, with progress tracking of what the user knows. A Pokédex browser is a secondary surface.

This repo also serves as a sandbox for practicing Claude Code sub-agent workflows - see the roster and playbook below. When choosing how to do work here, lean toward demonstrating sub-agent patterns over the fastest path, but only when the agent earns its keep.

## Stack
- Next.js 16.2.6 (App Router)
- React 19.2.6
- Tailwind CSS 4
- TypeScript 6

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## How to keep this file lean

Lean-AGENTS.md shape: `ops/standards/agents-md.md`; size discipline: `ops/standards/conventions.md` → Documentation. Pointer targets: process/orchestration/Actions/branching/release → [WORKFLOW.md](WORKFLOW.md); heavy subsystems → `docs/*.md`; per-agent pre-flight wording → `.claude/agents/*.md`. Collapse rationale and worked examples to one line + a pointer + at most one incident ref. `npm run lint:agents-size` (in the `lint` chain) fails CI past the line and byte ceilings; raise either only as a deliberate decision, like the coverage floor.

## Company standards (Layer 1)

Cross-project conventions live in **`Frazzled-Productions/ops` → `standards/`** ([conventions](https://github.com/Frazzled-Productions/ops/blob/main/standards/conventions.md), [process](https://github.com/Frazzled-Productions/ops/blob/main/standards/process.md), [agents-md](https://github.com/Frazzled-Productions/ops/blob/main/standards/agents-md.md)) and are the single source of truth for everything company-generic: British English, punctuation (no em dashes), attribution (maker's name only, no AI trailers), vendor screening, single-source-of-truth, testing discipline, discoverability, documentation roles, issue-first process, branching, versioning/release, and the pre-PR gate. This file **references up, never copies** - the sections below are only the poke-memory-specific instances and operative detail.

## Sub-agents and orchestration

Issue-first, acceptance-criteria cross-check, and skip-the-ceremony: `ops/standards/process.md`. Custom agents live in `.claude/agents/`; roster + playbook in [WORKFLOW.md](WORKFLOW.md#sub-agent-roster). Poke-memory wiring: every coder sub-agent (`ui-coder`, `data-coder`, `playwright`) runs `gh issue view` before writing code, enumerates the acceptance criteria, and stops to report any gap the brief omits; the orchestrator records a deliberate deferral (PR body, `## Acceptance criteria covered`) or extends the brief. Step-1 wording is in each agent's def (#1259 / #1260).

## File ownership

Each path has an owning agent (`ui-coder` for pages and components, `data-coder` for `app/api`, `lib`,
`db`; experts design, coders implement; orchestrator for README/CHANGELOG and `.claude/agents/**`;
`playwright` for `e2e/**`). Every `.github/workflows/**` change gets a `workflow-expert` review, no
exceptions. Full table: [WORKFLOW.md](WORKFLOW.md#file-ownership). Cross-layer fixes are default
routing, not a hard wall: `ops/standards/process.md` → File-ownership pattern (#1125).

## Conventions

The sections below state only what is specific to poke-memory or extends a standard for a documented local reason; the general principles are canonical in `ops/standards/` (see Layer 1 above).

### Single source of truth for shared concepts

Principle + forcing-function requirement: `ops/standards/conventions.md` → Single source of truth. Poke-memory wiring: `code-reviewer` raises any new direct field access on a domain object (`p.displayName`, `card.name`, `pokemon.sprite`) as a **Blocker** tagged "fragmentation" (#1259 / #1311 → #1318). Local forcing-function models: a lint rule (#1327's `no-restricted-syntax` ban on raw `.displayName`), a fitness/contract test (#1356 onConflict↔PK parity test), and type-system forcing (`computeStats(…, forceAllMastered)`); enforcement-gap candidates in #1405 / #1406.

**Existing helpers - use these, do not re-derive** (names, mastery, dates, stats, class names):
[docs/shared-helpers.md](docs/shared-helpers.md).

### Multi-locale rendering and message catalogues

Canonical reference: **[docs/i18n.md](docs/i18n.md)**. Headline rules:

- Every user-visible Pokémon name flows through `useLocalePokemonName(speciesId, fallbackName)`; a lint rule makes a raw `.displayName` read a CI error (#1327). Type names go through `getTypeName(type, t)` (`lib/i18n/typeNames.ts`) - inline capitalisation is banned (#1389 / #1405). Legitimate exceptions, `.map()` extraction pattern, and the English-leak gate (`npm run test:i18n-leak`) are in the doc.
- Catalogue changes: add the key to `messages/en.json` first, propagate to `messages/{ja,zh-Hans,zh-Hant}.json` (`npm run lint:i18n` fails on missing OR extra keys), then `npm run generate:pseudo-locale` and commit `xx-pseudo.json` (`npm run lint:pseudo-locale` fails on staleness; #1649 / #1654).

### Discoverability

Declare-a-discovery-path, reach-existing-users, and mock-up-on-visual-surface-proposals: `ops/standards/conventions.md` → Discoverability. Poke-memory wiring (review ownership, one-shot hint mechanics via a new `OnboardingFlags` key, `WhatsNewIndicator` usage, verify-in-a-populated-state): **[docs/discoverability.md](docs/discoverability.md)**.

### Next.js caching and page params

Cache Components is on; `params`/`searchParams` are Promises. Settled rules (`updateTag` vs
`revalidateTag(tag, 'max')`, `cacheTag`, `PageProps`): **[docs/nextjs.md](docs/nextjs.md)**.

### Superuser mode (READ when adding user-facing features)

Canonical reference: **[docs/superuser.md](docs/superuser.md)** - a QA cheat (type `super` on desktop, 7-tap the nav title on mobile) exposing per-axis flags: `pretendAllMastered`, `forceNextStreakMilestone`, `forceCardsGraduated`, `qaSeedMode` (scenario picker, `lib/qa-seed/scenarios.ts`). Headline rules:

- **Every new user-facing feature must honour the relevant flag.** Anything gated on mastery reads `useSuperuser().flags.pretendAllMastered`; canonical pattern `forceAllMastered || isMastered(...)`, pure functions take an optional `forceAllMastered` param. Never add a per-page toggle that re-derives mastery; a deliberate exemption is called out in the PR and acceptance criteria.
- **QA-seed data must be a faithful proxy for real data** (#1394) - match every real invariant, prefer deriving states through the real scheduler/hydration paths, enforce with forcing functions. Detail in the doc.
- **Sync write-guard**: while any flag is on, all cloud writes are suppressed and write-triggering buttons take the `superuserPaused` prop; background pulls stay enabled. Do not work around it.
- **Exit cleanup** (`SuperuserContext.exitCleanup`): signed-in force-pull + merge, guest destructive-reset confirm. Don't skip the prompt or the pull.

### Sync (READ FIRST when touching `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`)

Canonical reference: **[docs/sync.md](docs/sync.md)** - read before touching anything that pushes to Supabase. Headline rules:

- **Pull before push.** Any orchestrator merging cloud and local cards pulls and merges before pushing; if `pullSession` fails, do not push. Pushing on stale local state wiped 2497 of 2513 cloud rows (#293). The push-only retry path (`useRetryPush`) is the deliberate exception.
- **`card_reviews_reject_regression_trigger`** (migration 002, extended 015/016/017) blocks regressions at the DB layer. Don't work around it. Only `reset_all_progress` (migration 018, SECURITY DEFINER RPC) bypasses the per-column guards.
- **Cards are the primary contract.** Per-grade upsert + unload beacon drive the user-visible sync status. Every other leg (`pushSettings`, `pushStreak`, `pushGradeLog`, `pushRegionalPrefs`, the regional-prefs leg in `pullAndMerge`) is best-effort: `console.warn` and continue, never flip the overall sync into error.
- **Backups: daily on, PITR deferred** (#298). Daily-only restore is coarse (whole-database, up to ~24h loss), so treat any production sync change as one-way until PITR.

### Adding a feature that needs to persist data

Decision tree (JSONB on `user_settings` vs. column on `card_reviews` vs. new table) + new-table checklist: **[docs/persistence.md](docs/persistence.md)**. Card-shaped persistence keyed by `(user_id, card_type, subject_key)`: **[docs/card-identity.md](docs/card-identity.md)**. Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`, `push_subscriptions`, `feedback`, `usernames`, `rate_limit_buckets` (shapes, precedents and FK exceptions in the doc; a test keeps both lists in step with `db/migrations/`). Two runtime reminders:

- **Apply the migration BEFORE merging the PR**, to **both** Supabase projects (prod `mcp__supabase__apply_migration` and QA `mcp__supabase-qa__apply_migration`; name without the `0NN_` prefix). `migration-check.yml` asserts QA parity on qa-based PRs and prod parity on push to `main` (#1806) - mechanics in [docs/persistence.md](docs/persistence.md#apply-the-migration).
- **Wire cross-device sync** via `lib/sync/<feature>.ts` exporting `push` / `pull` (+ `merge`); pull as a best-effort leg in `pullAndMerge`, push wherever the data is written.


### PokéAPI integration

Seed at build time, never at request time; the canonical set is `/pokemon-species`. Endpoint, name,
sprite, evolution-tree and rate-limit rules: **[docs/pokeapi.md](docs/pokeapi.md)**; re-seeding:
**[docs/reseed.md](docs/reseed.md)**.

### Sprite rendering

Canonical reference and full rules: **[docs/sprites.md](docs/sprites.md)**. Default to `next/image`
(only `PokedexGrid.tsx` keeps a plain lazy `<img>`); sizes come from `lib/sprites/sizes.ts`, never a
pixel literal; `preload` only on the above-the-fold focal sprite (`priority` is lint-banned, #2015).

### Spaced repetition

Canonical reference: **[docs/srs.md](docs/srs.md)** (headline facts at the end). Never use
`MASTERY_REPETITIONS` in new mastery code (mastery is `stability >= 21`, #1765); the scheduler in
`lib/srs/` is pure and stays UTC; the cloud `grade_log` is not trimmed (#1956).

### Testing

Generic discipline: `ops/standards/conventions.md` → Testing discipline. Full tooling reference (vitest projects, de-flake, integration suite, coverage, e2e gotchas, coverage matrices): **[docs/testing.md](docs/testing.md)**. Non-negotiables:

- **Vitest is split by directory**: `node` project for `lib/**`, `jsdom` for `components/**` + `app/**`; a `renderHook` test must live under `components/` or CI fails with `document is not defined`.
- **De-flake against the FULL suite** (`npx vitest run --project <proj>` and `--changed origin/qa`), never file-alone (#1464 / #1470).
- **Any `db/migrations/*.sql` change must run the integration suite locally before push** (`VITEST_INTEGRATION=1 npm run test:integration` against the local `postgres:15` container) - `npm test` does not execute SQL (#1653). A new RPC action/enum value needs BOTH a migration AND a real-RPC integration test (#1883).
- **Coverage** (#824): global floor in `coverage-floor.json` (single source of truth, #1333) + 90% diff coverage on changed product lines.
- **E2E**: guest-mode smoke in `e2e/`, `chromium` + `mobile-safari`, `getByRole`-style selectors, one spec per feature area; every new user-facing flow gets a rendering + core-interaction test (absence-only is insufficient). Webkit flex/height changes need a local `mobile-safari` prod-build run (#1837 / #1876); the service worker bypasses `page.route` stubs and only registers in prod builds (#1650 / #1773) - see docs/testing.md before writing e2e for API-submit or offline flows.
- **State and locale coverage are mandatory** for every user-facing change (#1302 / #1327): drive unreachable states via QA-seed scenarios or superuser flags, and test names/labels in every supported locale (`en`, `ja`, `zh-Hans`, `zh-Hant`) on both axes, including lint-exempted surfaces. Localised numbers gain digit-grouping and break `\d+` assertions (#1408).

### Local development gotchas

localStorage drift between `localhost` and production, the pinned Node major (`.nvmrc`), "unlimited
reviews" on a fresh session, evolution-card scope matching: **[docs/local-dev.md](docs/local-dev.md)**.

### Documentation

Roles + update-inline-in-the-landing-commit: `ops/standards/conventions.md` → Documentation. Canonical references here: **[WORKFLOW.md](WORKFLOW.md)** (process map: roster, playbook, Actions catalog, issue lifecycle, branching, release, build gates, retrospectives) and **`docs/*.md`** ([sync](docs/sync.md), [persistence](docs/persistence.md), [card-identity](docs/card-identity.md), [srs](docs/srs.md), [sprites](docs/sprites.md), [i18n](docs/i18n.md), [testing](docs/testing.md), [superuser](docs/superuser.md), [screenshots](docs/screenshots.md), [discoverability](docs/discoverability.md), [shared-helpers](docs/shared-helpers.md), [nextjs](docs/nextjs.md), [pokeapi](docs/pokeapi.md), [local-dev](docs/local-dev.md)).

### Screenshots

When a change visibly affects any of the six README screenshot surfaces (`app/page.tsx`, `app/pokedex/**`, `app/pasture/**`, `app/stats/**`, `app/journey/**`, or a rendered `components/**`), regenerate the affected screenshot(s) with `npm run screenshots` (macOS only) and commit them in the same PR. Full runbook (viewport, seed, animations, size caps): **[docs/screenshots.md](docs/screenshots.md)**.

### Writing, versioning, branching, stack

- **Writing:** British English + no em dashes: `ops/standards/conventions.md` → Writing. Poké-specific out-of-scope identifiers to leave alone: PokéAPI fields, FSRS (`optimizer`), shipped Supabase column names.
- **Versioning:** SemVer, `package.json`-as-single-source, changelog fragments, owner approval for a non-patch bump: `ops/standards/process.md` → Versioning & release. Poke-memory wiring: the daily `auto-release.yml` cron assembles `changelog.d/unreleased/*.md` fragments (`kind: minor-bump` → minor; otherwise patch) and tags; a `minor-bump` fragment needs the owner-applied `version-bump:approved` label (`version-bump-gate.yml`). Fragment format and the release pipeline live in [WORKFLOW.md](WORKFLOW.md) and `changelog.d/README.md`.
- **Branching:** Two-long-lived-branch model (#806): `ops/standards/process.md` → Branching model; diagram and rulesets in [WORKFLOW.md](WORKFLOW.md). Poke-memory specifics: the source-gate check is named `Restrict main PR source` (overridden by the owner-applied `hotfix` label); `qa`'s required checks are `test` + `e2e` (no strict-up-to-date); every PR-producing path targets `qa`.
- **Stack decisions:** Vendor screening (`[USER-DECISION]`, default-to-blocker, no-beta, single-vendor): `ops/standards/conventions.md` → Stack / vendor screening. Poké-specific: plan persistence shape for plausible future scope (per-card analytics, friends/social).

### Backlog / process

Backlog labels, user-owns-priorities, the pre-PR gate, and the pre-push spelling check: `ops/standards/process.md`. Full process map: [WORKFLOW.md](WORKFLOW.md). Poke-memory runtime specifics:

- The orchestrator usually starts with `gh issue list --label "priority:now"`; reference the closed issue in the commit (`closes #N`).
- **Pre-PR build gate (one command): `npm run pre-pr`** (#1716) - fail-fast lint → typecheck → build → test → coverage → diff-coverage. Mechanics, the diff-coverage gotcha (#1642 / #1649), `DIFF_COVERAGE_BASE` override, and the e2e smoke subset for high-surface-area diffs: [WORKFLOW.md](WORKFLOW.md#local-pre-pr-gate-npm-run-pre-pr).
- **Push with an explicit `git push origin <branch>` - never a bare `git push`** (worktree upstreams point at `origin/qa`, #1474; mirrors the `gh pr create --head <branch>` rule). Detail in the same WORKFLOW.md section.
- **Review on PR open**: `auto-review.yml` was removed on 2026-08-16 with the rest of the Claude automation, so **nothing reviews a PR automatically any more**. Run `code-reviewer` yourself against the linked issue's acceptance criteria before asking for a merge. (The old instruction here said the opposite, which after the removal would have meant no review happened at all.) For CI that doesn't converge, use `/investigate-ci-failure` (#1234 / #1263).
- **Planner pre-flight checks** (#1321 / #1322 / #1276) and the mini-batch-after-preview-QA / end-of-session retro (#1333) flows are owned by `.claude/agents/planner.md` and the `/batch-issues` skill. For a single linear change use **`/ship`** (`.claude/commands/ship.md`, #1718), which defers to `/batch-issues` for the gate/review/branching rules.

### Privacy

- **Guest**: all card/session data stays in the browser (localStorage), never transmitted to a server we control; only technical error diagnostics (no progress or account data) go to Sentry (below). Sprites are self-hosted static files. Vercel Analytics + Speed Insights collect anonymous aggregate metrics only (no card progress or PII); both render unconditionally in the root layout.
- **Authenticated (Supabase sync)**: on GitHub sign-in, per-card FSRS review history is stored in Supabase Postgres and we **are a data controller** - GDPR/UK-GDPR applies (privacy notice, lawful basis, Supabase standard DPA). RLS scopes every user to their own rows. Sub-processors: Supabase (authenticated data), Vercel Analytics (aggregate telemetry), Sentry (EU region, all users incl. guests: error reports + ~10% traces, no name/email/account ID/IP attached, no cookies or bodies, no Replay, 90-day retention, legitimate interests; #2103). Sign-out does **not** clear localStorage - local data is preserved so users can continue as guests.

## OpenSpec

Every change goes through OpenSpec (`openspec/config.yaml` holds the house rules; owner decision
21 October 2026). Specs in `openspec/specs/` describe the app as it is on `qa`.

- **Before asking for approval**, run the read-only consistency pass in `openspec/config.yaml` (tasks
  rules) and put its result at the top of the review message; decisions go in AskUserQuestion. Every
  proposal has "Removes" and ends with dated "Clarifications". A change that alters no behaviour
  (refactor, docs, tooling whose behaviour stays the same) sets `skip_specs: true` in its
  `.openspec.yaml` with no `specs/` folder; any behaviour change follows spec on touch.
- **After the build**, run `/opsx:verify <change>` before the final review, and fix or list what it
  finds. The `/opsx:*` commands and `openspec-*` skills in `.claude/` are generated by `openspec update`
  (profile: core plus verify, set with `openspec config profile`). After regenerating, replace any em
  dash it writes and keep the "do not archive by hand" note in the archive command and skill.
- **Archived changes have every task ticked** (`openspec validate --archived`, in the shared archive
  checks): a task left for later is moved to an issue and ticked as "~~...~~ Moved to #N (date)".
- **Write the delta in the feature PR**, in `openspec/changes/<name>/`. When the change makes an
  existing requirement wrong, MODIFY or REMOVE it in the delta; never leave it for the archive. Use
  RENAMED when a requirement's meaning changes, so its title stays true. A delta that creates a new
  capability starts with a `## Purpose` paragraph.
- **The tooling below is shared** (owner decision 23 October 2026): each workflow here is a short
  caller of a reusable workflow in `Frazzled-Productions/.github` at `@v1`, and the scripts named
  below live there (`tools/openspec/`, `tools/ci/`, with their tests), fetched by each run from that
  repository at the workflow's own commit, never from this tree. Change them there; this repo picks the
  change up when `v1` moves. Spec: Roast Conductor's `openspec/specs/openspec-tooling/`.
- **OpenSpec required** fails a PR into `qa` that is not docs-only unless it adds or edits an active
  change with a delta or `skip_specs: true`; the only exception is Fraser's `no-spec` label with a
  `## No spec` reason in the PR body. **Context budget** fails when a file passes
  `.github/context-budget.txt`. Both are required on `qa` only; promotions to `main` need no change.
- **Never archive by hand** (no `openspec archive`, no `/opsx:archive`, no archive PRs). The bot does
  it after merge (owner decision 22 October 2026): `.github/workflows/openspec-archive.yml` runs on
  every push to `qa` that touches `openspec/changes/`, archives each active change in name order
  with `openspec archive <name> --yes`, checks the result (`tools/openspec/archive.py`: no
  "TBD - created" Purpose, `openspec validate --specs --strict`, no em dashes, nothing outside
  `openspec/`), commits each as "Archive OpenSpec change <name> into the main specs" on the branch
  `openspec-archive` and opens a PR into `qa`. GitHub holds the pull_request checks on a PR the bot
  opens, so the bot approves its own PR's held checks (owner decision 22 October 2026,
  roast-conductor#168) through `tools/openspec/approve_runs.py`, which refuses unless the PR is the
  bot's, from `openspec-archive` into `qa` in this repository, at the commit just pushed, with only
  plain files under `openspec/` changed. It then turns on auto-merge (rebase): GitHub merges only when
  the `qa-staging` checks pass (its `required-contexts` must list exactly that ruleset's checks).
  Every 30 minutes a second job opens an issue if an archive PR has been open for more than 30
  minutes. Needs the repo setting "Allow GitHub Actions to create and approve pull requests".
- **CI's docs-only fast path:** `ci.yml`'s `changes` job treats `openspec/**` like Markdown and
  `docs/`, so a PR that only changes docs or OpenSpec files (the archive bot's included) skips the
  build inside the required `test` job; the always-run `em-dash` job still checks them.
- **OpenSpec overlap** (`.github/workflows/openspec-overlap.yml`, shared `tools/openspec/overlap.py`) runs on
  every PR: `openspec validate --strict` on the PR's changes, then it fails if another open PR's
  delta MODIFIES, REMOVES or RENAMES the same requirement (the second archive would silently
  overwrite the first) or a target is no longer on `qa`. Fix by landing one PR first, then
  rebasing the other and rewriting its delta against the result. Local run:
  `python3 <.github checkout>/tools/openspec/overlap.py --this-files <delta spec.md files>`, run from
  this repo's root. Its last step, "Simulated archive", archives every active change on a copy and
  fails if the merged specs fail `openspec validate --specs --strict` (for example a MODIFIED
  requirement over 500 characters), naming each change "from this PR" or "already on main". Local
  run: `python3 <.github checkout>/tools/openspec/archive.py simulate` from this repo's root.
- **If the bot opens an issue** (label `openspec`, "OpenSpec archive failed: <name>"), nothing
  landed and the change is still active on `qa`. The issue opens with the real error ("Why it
  failed"), and the failing run's log ends with the same lines; the script Actions prints at the start
  of each step is its source, not an error. Fix the delta (or the spec) on a branch, run
  `python3 <.github checkout>/tools/openspec/archive.py archive <name>` from the root of a scratch copy
  to prove it (then discard the result), and merge the fix: the bot retries on that merge. Use "Run
  workflow" on OpenSpec archive to retry without a change. When a later run archives the change, the
  bot comments on its own issue (linking the run and the archive PR) and closes it; an issue a person
  opened, or the bot's "all changes", "unexpected change folder" and stuck-PR issues, are closed by hand.

## Delegated work and the stall watcher

When you hand work to a background agent or start a long background step, register it in the task
ledger first, with the agent id from the launch result as the owner:
`~/Projects/frazzled-productions/ops/scripts/task.sh add --title "..." --repo <repo> --branch <branch> --expected <output> --estimate <minutes> --owner <agent or session id>`.
Expected outputs must be checkable: `pr_open`, `pr_has_artefact:<glob, label:NAME or body:TEXT>`,
`checks_green`, `file_updated:<path>`, `issue_closed:<n>`. Record each milestone with
`task.sh progress <id> <note>` and finish with `task.sh done <id>`; only the watcher closes an entry,
once the output exists. Keep handoffs in files and issues, not only in chat. Say a task is "running"
only when it shows progress in the last 20 minutes; otherwise say "no progress for N minutes" and
name the newest signal. Runbook: `ops/runbooks/command-centre.md`.
