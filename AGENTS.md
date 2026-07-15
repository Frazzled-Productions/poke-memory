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

| Path | Owner |
|---|---|
| `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/loading.tsx`, `app/**/error.tsx` | ui-coder |
| `components/**` | ui-coder |
| `app/api/**` | data-coder |
| `lib/**` | data-coder |
| `db/**` | data-coder |
| Server Actions | data-coder (implementation), ui-coder (call sites) |
| SRS scheduler | srs-expert designs the algorithm; data-coder implements + persists |
| PokéAPI integration | pokeapi-expert designs endpoints/caching; data-coder implements |
| Supabase schema / RLS | supabase-expert designs; data-coder implements |
| Privacy notice / Terms / `docs/` compliance files (`dpia.md`, `childrens-code-assessment.md`, `cookies-pecr.md`); any third-party SDK/service install that could collect, transmit, or log personal data (analytics, error monitoring, messaging, A/B testing) | privacy-expert advises (read-only); ui-coder edits the `/privacy` and `/terms` pages, orchestrator edits the `docs/` compliance files |
| Multi-locale work (`pokemonNameLocale`, `appLocale`, transliteration, message catalogs, locale routing, locale-aware sync, adding a new locale) | i18n-expert advises (read-only); data-coder implements settings/sync/seed changes, ui-coder implements rendering, catalogs, and `<lang>` placement |
| Onboarding / discoverability surfaces (`components/onboarding/**`, empty states, locked-state UI, first-contact flows, nav affordances) | ux-advisor advises (read-only); ui-coder implements |
| `README.md`, `CHANGELOG.md` | orchestrator - updated inline as part of each commit, no specialist agent |
| `e2e/**` | playwright |
| `.github/workflows/**` | workflow-expert review on EVERY change, no mechanical-change exception (complexity is not the gate, YAML's silent-failure mode is - #1859/#1815/#1806); orchestrator (edits) |
| `.claude/agents/**` | workflow-expert (review); orchestrator (edits) |

**Cross-layer fixes.** Default routing, not a hard wall: `ops/standards/process.md` → File-ownership pattern (#1125). Worked example: a `ui-coder` finding the root cause in `lib/` touches the helper in the same change (#1117 / #1121).

## Conventions

The sections below state only what is specific to poke-memory or extends a standard for a documented local reason; the general principles are canonical in `ops/standards/` (see Layer 1 above).

### Single source of truth for shared concepts

Principle + forcing-function requirement: `ops/standards/conventions.md` → Single source of truth. Poke-memory wiring: `code-reviewer` raises any new direct field access on a domain object (`p.displayName`, `card.name`, `pokemon.sprite`) as a **Blocker** tagged "fragmentation" (#1259 / #1311 → #1318). Local forcing-function models: a lint rule (#1327's `no-restricted-syntax` ban on raw `.displayName`), a fitness/contract test (#1356 onConflict↔PK parity test), and type-system forcing (`computeStats(…, forceAllMastered)`); enforcement-gap candidates in #1405 / #1406.

**Existing helpers - use these, do not re-derive.**

- `useLocalePokemonName(id, fallback)` from `lib/i18n/useLocalePokemonName.ts` - Pokémon name rendering (locale-aware).
- `formatDate(iso, fmt, tz)` / `formatShortDate(iso, fmt)` from `lib/utils/format-date.ts` - user-facing date display. `todayInTimezone(tz)` for the current day boundary; `isoDate(d)` for the scheduling-internal `"YYYY-MM-DD"` form.
- `isMastered(state, masteryRepetitions)` from `lib/stats/derive.ts` - single mastery check.
- `filterMastered(cards, …)` from `lib/pasture/arrivals.ts` - mastery filter honouring the superuser `forceAllMastered` axis.
- `computeStats(…)` from `lib/stats/derive.ts` - aggregate stats with the same superuser axis.
- `masteredSpeciesIds(…)` from `lib/badges/derive.ts` - mastered species set.
- `useCardClass(…)` from `lib/review/useCardClass.ts` - card-class derivation.
- Class-name constants in `lib/utils/class-names.ts` (`cardPanel`, `cardPanelPadded`, `colStack`, `colStackLg`, `sectionLabel`, `dialogPanel`, `statValue`, `chartTickText`, `mutedText`, `inlineLink`, `mutedTextXs`, `chartTooltipCard`) - never inline the underlying Tailwind literal.

### Multi-locale rendering and message catalogues

Canonical reference: **[docs/i18n.md](docs/i18n.md)**. Headline rules:

- Every user-visible Pokémon name flows through `useLocalePokemonName(speciesId, fallbackName)`; a lint rule makes a raw `.displayName` read a CI error (#1327). Type names go through `getTypeName(type, t)` (`lib/i18n/typeNames.ts`) - inline capitalisation is banned (#1389 / #1405). Legitimate exceptions, `.map()` extraction pattern, and the English-leak gate (`npm run test:i18n-leak`) are in the doc.
- Catalogue changes: add the key to `messages/en.json` first, propagate to `messages/{ja,zh-Hans,zh-Hant}.json` (`npm run lint:i18n` fails on missing OR extra keys), then `npm run generate:pseudo-locale` and commit `xx-pseudo.json` (`npm run lint:pseudo-locale` fails on staleness; #1649 / #1654).

### Discoverability

Declare-a-discovery-path, reach-existing-users, and mock-up-on-visual-surface-proposals: `ops/standards/conventions.md` → Discoverability. Poke-memory wiring (review ownership, one-shot hint mechanics via a new `OnboardingFlags` key, `WhatsNewIndicator` usage, verify-in-a-populated-state): **[docs/discoverability.md](docs/discoverability.md)**.

### Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- Read-your-own-writes after a Server Action mutation: `updateTag(tag)` (Server Actions only).
- Background SWR-style invalidation from Route Handlers: `revalidateTag(tag, 'max')` (the single-arg form is deprecated and a TS error).
- `revalidatePath('/path')` only for path-level data, not specific tags.
- Tag underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions - without that, `updateTag` has nothing to invalidate.

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

Decision tree (JSONB on `user_settings` vs. column on `card_reviews` vs. new table) + new-table checklist: **[docs/persistence.md](docs/persistence.md)**. Card-shaped persistence keyed by `(user_id, card_type, subject_key)`: **[docs/card-identity.md](docs/card-identity.md)**. Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`. Two runtime reminders:

- **Apply the migration BEFORE merging the PR**, to **both** Supabase projects (prod `mcp__supabase__apply_migration` and QA `mcp__supabase-qa__apply_migration`; name without the `0NN_` prefix). `migration-check.yml` asserts QA parity on qa-based PRs and prod parity on push to `main` (#1806) - mechanics in [docs/persistence.md](docs/persistence.md#apply-the-migration).
- **Wire cross-device sync** via `lib/sync/<feature>.ts` exporting `push` / `pull` (+ `merge`); pull as a best-effort leg in `pullAndMerge`, push wherever the data is written.

### Page params

- `params` and `searchParams` are `Promise` - always `await` them. Synchronous access is fully removed.
- Prefer the generated `PageProps<'/path/[seg]'>` helper after `next typegen` / first dev / first build. The manual inline `params: Promise<{ slug: string }>` always works without that step.

### PokéAPI integration

- **Seed at build time, not request time.** A one-off seed script fetches `/pokemon-species` (master list) → `/pokemon/{id}` (sprites) → `/pokemon-species/{id}` (display name + chain URL) → `/evolution-chain/{id}` (deduped) into a local store. The Pokédex never hits PokéAPI at runtime.
- **Canonical set is `/pokemon-species`** (~1025 species), not `/pokemon` (~1300+ incl. Megas/regional/Gigantamax at IDs 10001+). Resolve each species to `varieties[0]`.
- **Display name** is `pokemon-species.names[]` filtered to `language.name === "en"`. The `/pokemon` `name` field is a kebab-case slug.
- **Default sprite**: `sprites.other["official-artwork"].front_default`, falling back to `sprites.front_default`. Sprites self-hosted under `public/sprites/pokemon/`.
- **Evolution chains are trees** - `evolves_to[]` may branch (Eevee → 8). Walk recursively.
- **Rate limit** ~100/min: cap concurrency at ~20–30, don't aggressively retry on 429.
- **Re-seeding a new generation**: `npm run seed:all` (additive default). Full runbook in **[docs/reseed.md](docs/reseed.md)**.

### Sprite rendering

Canonical reference: **[docs/sprites.md](docs/sprites.md)**. Headline rules:

- **Default to `next/image`.** The only exemption is the Pokédex grid (`PokedexGrid.tsx`), which keeps a plain lazy `<img>` to avoid per-cell wrapper overhead across ~1025 tiles.
- **`/_next/image` is NOT used for sprites.** A global custom loader (`lib/sprites/imageLoader.ts`) redirects sprite paths to pre-generated static WebP under `public/sprites/pokemon/webp/`. Run `npm run seed:sprites` after adding a size constant.
- **Sprite sizes are named constants in `lib/sprites/sizes.ts`** - never inline a pixel literal; it must match the painted CSS size or the wrong WebP variant ships.
- **`priority` is for the above-the-fold focal sprite only.** Off-screen / list-tile sprites stay lazy.

### Spaced repetition

Canonical reference: **[docs/srs.md](docs/srs.md)**. Headline facts:

- **Grading**: `Again` (1) / `Hard` (2) / `Good` (4) / `Easy` (5), mapped to FSRS's `Rating` enum at the boundary in `lib/srs/scheduler.ts`.
- **Mastery**: `reps >= masteryRepetitions && scheduledDays >= 21`.
- **Dates**: scheduling-internal dates are `"YYYY-MM-DD"` UTC strings; user-facing day boundaries (today / streak / daily cap) are timezone-aware via `todayInTimezone(tz)` + `user_settings.timezone` (migration 019). Pass the user's tz through display/daily-cap code; stay UTC inside the scheduler.
- **Scheduler is pure**, in `lib/srs/`. `nextReview(state, grade, now, options?)` is the single chokepoint reading `retentionTarget`.

### Testing

Generic discipline: `ops/standards/conventions.md` → Testing discipline. Full tooling reference (vitest projects, de-flake, integration suite, coverage, e2e gotchas, coverage matrices): **[docs/testing.md](docs/testing.md)**. Non-negotiables:

- **Vitest is split by directory**: `node` project for `lib/**`, `jsdom` for `components/**` + `app/**`; a `renderHook` test must live under `components/` or CI fails with `document is not defined`.
- **De-flake against the FULL suite** (`npx vitest run --project <proj>` and `--changed origin/qa`), never file-alone (#1464 / #1470).
- **Any `db/migrations/*.sql` change must run the integration suite locally before push** (`VITEST_INTEGRATION=1 npm run test:integration` against the local `postgres:15` container) - `npm test` does not execute SQL (#1653). A new RPC action/enum value needs BOTH a migration AND a real-RPC integration test (#1883).
- **Coverage** (#824): global floor in `coverage-floor.json` (single source of truth, #1333) + 90% diff coverage on changed product lines.
- **E2E**: guest-mode smoke in `e2e/`, `chromium` + `mobile-safari`, `getByRole`-style selectors, one spec per feature area; every new user-facing flow gets a rendering + core-interaction test (absence-only is insufficient). Webkit flex/height changes need a local `mobile-safari` prod-build run (#1837 / #1876); the service worker bypasses `page.route` stubs and only registers in prod builds (#1650 / #1773) - see docs/testing.md before writing e2e for API-submit or offline flows.
- **State and locale coverage are mandatory** for every user-facing change (#1302 / #1327): drive unreachable states via QA-seed scenarios or superuser flags, and test names/labels in every supported locale (`en`, `ja`, `zh-Hans`, `zh-Hant`) on both axes, including lint-exempted surfaces. Localised numbers gain digit-grouping and break `\d+` assertions (#1408).

### Local development gotchas

- `localhost:3000` and `pokememory.com` are different origins → independent `localStorage`. When local dev and deployed behaviour differ, suspect localStorage drift first - clear the `poke-memory:*` keys and reload, or QA against the latest preview URL.
- **Build needs the pinned Node major** (`.nvmrc`; `.npmrc` `engine-strict` + a `prebuild` guard fail-fast, #1493). Node 26 breaks the esbuild-wasm/Turbopack build - `nvm use` or a Homebrew `node@24` on `PATH`, and brief sub-agents the same (they inherit the machine default).
- **"Unlimited reviews" on a fresh session isn't a bug**: `buildSessionQueues` (`lib/review/session.ts`) only counts a review toward `reviewsDoneToday` when `lastReview === today && firstSeen !== today`, so the 100/day soft wall can't fire until prior-day cards come due; totals are bounded by the new-card caps × learning-step replays.
- **Evolution cards inherit the pre-evo's types for scope matching (#426)**: `cardMatchesScope` (`lib/review/scope.ts`) resolves `card.preEvoId` to its `SeedPokemon.types` - a Fire scope includes `Charmander → Charmeleon` but excludes `Eevee → Flareon`. Forward and reverse evo cards anchor all three axes on the pre-evo.

### Documentation

Roles + update-inline-in-the-landing-commit: `ops/standards/conventions.md` → Documentation. Canonical references here: **[WORKFLOW.md](WORKFLOW.md)** (process map: roster, playbook, Actions catalog, issue lifecycle, branching, release, build gates, retrospectives) and **`docs/*.md`** ([sync](docs/sync.md), [persistence](docs/persistence.md), [card-identity](docs/card-identity.md), [srs](docs/srs.md), [sprites](docs/sprites.md), [i18n](docs/i18n.md), [testing](docs/testing.md), [superuser](docs/superuser.md), [screenshots](docs/screenshots.md), [discoverability](docs/discoverability.md)).

### Writing

British English + no em dashes: `ops/standards/conventions.md` → Writing. Poké-specific out-of-scope identifiers to leave alone: PokéAPI fields, FSRS (`optimizer`), shipped Supabase column names.

### Screenshots

When a change visibly affects any of the six README screenshot surfaces (`app/page.tsx`, `app/pokedex/**`, `app/pasture/**`, `app/stats/**`, `app/journey/**`, or a rendered `components/**`), regenerate the affected screenshot(s) with `npm run screenshots` (macOS only) and commit them in the same PR. Full runbook (viewport, seed, animations, size caps): **[docs/screenshots.md](docs/screenshots.md)**.

### Versioning

SemVer, `package.json`-as-single-source, changelog fragments, owner approval for a non-patch bump: `ops/standards/process.md` → Versioning & release. Poke-memory wiring: the daily `auto-release.yml` cron assembles `changelog.d/unreleased/*.md` fragments (`kind: minor-bump` → minor; otherwise patch) and tags; a `minor-bump` fragment needs the owner-applied `version-bump:approved` label (`version-bump-gate.yml`). Fragment format and the release pipeline live in [WORKFLOW.md](WORKFLOW.md) and `changelog.d/README.md`.

### Branching model

Two-long-lived-branch model (#806): `ops/standards/process.md` → Branching model; diagram and rulesets in [WORKFLOW.md](WORKFLOW.md). Poke-memory specifics: the source-gate check is named `Restrict main PR source` (overridden by the owner-applied `hotfix` label); `qa`'s required checks are `test` + `e2e` (no strict-up-to-date); every PR-producing path targets `qa`.

### Stack decisions

Vendor screening (`[USER-DECISION]`, default-to-blocker, no-beta, single-vendor): `ops/standards/conventions.md` → Stack / vendor screening. Poké-specific: plan persistence shape for plausible future scope (per-card analytics, friends/social).

### Backlog / process

Backlog labels, user-owns-priorities, the pre-PR gate, and the pre-push spelling check: `ops/standards/process.md`. Full process map: [WORKFLOW.md](WORKFLOW.md). Poke-memory runtime specifics:

- The orchestrator usually starts with `gh issue list --label "priority:now"`; reference the closed issue in the commit (`closes #N`).
- **Pre-PR build gate (one command): `npm run pre-pr`** (#1716) - fail-fast lint → typecheck → build → test → coverage → diff-coverage. Mechanics, the diff-coverage gotcha (#1642 / #1649), `DIFF_COVERAGE_BASE` override, and the e2e smoke subset for high-surface-area diffs: [WORKFLOW.md](WORKFLOW.md#local-pre-pr-gate-npm-run-pre-pr).
- **Push with an explicit `git push origin <branch>` - never a bare `git push`** (worktree upstreams point at `origin/qa`, #1474; mirrors the `gh pr create --head <branch>` rule). Detail in the same WORKFLOW.md section.
- **Auto-review on PR open**: `auto-review.yml` runs `code-reviewer` automatically against the linked issue's acceptance criteria - do not run it yourself in the implement stage. For CI that doesn't converge, use `/investigate-ci-failure` (#1234 / #1263).
- **Planner pre-flight checks** (#1321 / #1322 / #1276) and the mini-batch-after-preview-QA / end-of-session retro (#1333) flows are owned by `.claude/agents/planner.md` and the `/batch-issues` skill. For a single linear change use **`/ship`** (`.claude/commands/ship.md`, #1718), which defers to `/batch-issues` for the gate/review/branching rules.

### Privacy

- **Guest**: all card/session data stays in the browser (localStorage), never transmitted to a server we control. Sprites are self-hosted static files. Vercel Analytics + Speed Insights collect anonymous aggregate metrics only (no card progress or PII); both render unconditionally in the root layout.
- **Authenticated (Supabase sync)**: on GitHub sign-in, per-card FSRS review history is stored in Supabase Postgres and we **are a data controller** - GDPR/UK-GDPR applies (privacy notice, lawful basis, Supabase standard DPA). RLS scopes every user to their own rows. Sub-processors: Supabase (authenticated data), Vercel Analytics (aggregate telemetry). Sign-out does **not** clear localStorage - local data is preserved so users can continue as guests.
