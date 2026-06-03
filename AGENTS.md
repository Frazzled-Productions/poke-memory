# poke-memory

An Anki-style spaced-repetition app for learning Pokémon names and evolutions, with progress tracking of what the user knows. A Pokédex browser is a secondary surface.

This repo also serves as a sandbox for practicing Claude Code sub-agent workflows — see the roster and playbook below. When choosing how to do work here, lean toward demonstrating sub-agent patterns over the fastest path, but only when the agent earns its keep.

## Stack
- Next.js 16.2.6 (App Router)
- React 19.2.6
- Tailwind CSS 4
- TypeScript 6

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## How to keep this file lean

Lean-AGENTS.md principle (loads every session; index, don't duplicate): `ops/standards/conventions.md` → Documentation. Repo-specific pointer targets and budget:

- **Process / orchestration / GitHub Actions / branching / release mechanics** → [WORKFLOW.md](WORKFLOW.md).
- **Heavy subsystems** (sync, persistence, SRS, sprites, card-identity) → `docs/*.md`.
- **Per-agent pre-flight checks and step wording** → `.claude/agents/*.md`.

Collapse rationale narration and worked-example chains to one line plus a pointer and at most one incident ref (`#NNNN`). A size budget (`npm run lint:agents-size`, in the `lint` chain) fails CI if this file grows past its ceiling; raise the ceiling only with a deliberate decision, the same way the coverage floor is ratcheted.

## Company standards (Layer 1)

Cross-project conventions live in the company standards repo **`Frazzled-Productions/ops` → `standards/`** ([conventions](https://github.com/Frazzled-Productions/ops/blob/main/standards/conventions.md), [process](https://github.com/Frazzled-Productions/ops/blob/main/standards/process.md)) and are the single source of truth for them. This file **references up, never copies**: the rules below are the Poké-Memory-specific instances and operative detail; the general principle behind each sits in `standards/`. What's company-generic (British English, punctuation, attribution, vendor screening, single-source-of-truth, testing discipline, branching, release, the pre-PR gate) is canonical there.

## Sub-agents and orchestration

Issue-first, acceptance-criteria cross-check, and skip-the-ceremony: `ops/standards/process.md`. Custom agents live in `.claude/agents/`. The full roster, when to use each, and the plan → research → implement → E2E → review playbook are in [WORKFLOW.md](WORKFLOW.md#sub-agent-roster).

**Issue-body cross-check (implementer-side, poke-memory wiring).** Every coder sub-agent (`ui-coder`, `data-coder`, `playwright`) runs `gh issue view` against the linked issue before writing code, enumerates its acceptance criteria, and compares them to the orchestrator's brief. If the brief omits a criterion, the coder stops and reports the gap rather than implementing only what the brief covered. The orchestrator either records the omission as a deliberate deferral (PR body, `## Acceptance criteria covered`) or extends the brief. Step-1 wording is in each agent's def. **Briefs may extend, not contract** — a brief that adds detail beyond the issue is fine; one that drops scope is the failure mode this check exists to surface (#1259 / #1260).

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
| Privacy notice / Terms / `docs/` compliance files (`dpia.md`, `childrens-code-assessment.md`, `cookies-pecr.md`) | privacy-expert advises (read-only); ui-coder edits the `/privacy` and `/terms` pages, orchestrator edits the `docs/` compliance files |
| Multi-locale work (`pokemonNameLocale`, `appLocale`, transliteration, message catalogs, locale routing, locale-aware sync, adding a new locale) | i18n-expert advises (read-only); data-coder implements settings/sync/seed changes, ui-coder implements rendering, catalogs, and `<lang>` placement |
| Onboarding / discoverability surfaces (`components/onboarding/**`, empty states, locked-state UI, first-contact flows, nav affordances) | ux-advisor advises (read-only); ui-coder implements |
| `README.md`, `CHANGELOG.md` | orchestrator — updated inline as part of each commit, no specialist agent |
| `e2e/**` | playwright |
| `.github/workflows/**` | workflow-expert (review); orchestrator (edits) |
| `.claude/agents/**` | workflow-expert (review); orchestrator (edits) |

**Cross-layer fixes.** File-ownership-as-default-routing-not-a-hard-wall: `ops/standards/process.md` → File-ownership pattern (#1125). Poke-memory worked example: a `ui-coder` finding the root cause in `lib/` touches the helper in the same change (#1117 / #1121).

## Conventions

Cross-project engineering, process, and writing conventions live in `ops/standards/conventions.md` and `ops/standards/process.md` (the company Layer-1 truth). The sections below state only what is specific to poke-memory or extends a standard for a documented local reason; they reference up rather than restating.

### Single source of truth for shared concepts

Principle and rationale (one shared helper per concept; fragmentation is the failure mode; trade-off; every helper ships a forcing function): `ops/standards/conventions.md` → Single source of truth. Poke-memory wiring: `code-reviewer` raises any new direct field access on a domain object (`p.displayName`, `card.name`, `pokemon.sprite`) as a **Blocker** tagged "fragmentation" (#1259 / #1260, #1311 → #1318).

**Existing helpers — use these, do not re-derive.**

- `useLocalePokemonName(id, fallback)` from `lib/i18n/useLocalePokemonName.ts` — Pokémon name rendering (locale-aware).
- `formatDate(iso, fmt, tz)` / `formatShortDate(iso, fmt)` from `lib/utils/format-date.ts` — user-facing date display. `todayInTimezone(tz)` for the current day boundary; `isoDate(d)` for the scheduling-internal `"YYYY-MM-DD"` form.
- `isMastered(state, masteryRepetitions)` from `lib/stats/derive.ts` — single mastery check.
- `filterMastered(cards, …)` from `lib/pasture/arrivals.ts` — mastery filter honouring the superuser `forceAllMastered` axis.
- `computeStats(…)` from `lib/stats/derive.ts` — aggregate stats with the same superuser axis.
- `masteredSpeciesIds(…)` from `lib/badges/derive.ts` — mastered species set.
- `useCardClass(…)` from `lib/review/useCardClass.ts` — card-class derivation.
- Class-name constants in `lib/utils/class-names.ts` (`cardPanel`, `cardPanelPadded`, `colStack`, `colStackLg`, `sectionLabel`, `dialogPanel`, `statValue`, `chartTickText`, `mutedText`, `inlineLink`, `mutedTextXs`, `chartTooltipCard`) — never inline the underlying Tailwind literal.

**Forcing-function models (poke-memory).** The standard requires every single-source helper to ship a CI-failing forcing function; the local models are a **lint rule** (#1327's `no-restricted-syntax` ban on raw `.displayName`), a **fitness/contract test** (#1356 onConflict↔PK parity test), and **type-system forcing** (`computeStats(…, forceAllMastered)`). Enforcement-gap candidates tracked in #1405 / #1406.

### Multi-locale rendering

All Pokémon names shown to users flow through `useLocalePokemonName(speciesId, fallbackName)` (`lib/i18n/useLocalePokemonName.ts`). A `no-restricted-syntax` lint rule in `eslint.config.mjs` (covering `components/**` and `app/**` minus `app/api/**`) makes a direct `.displayName` read a CI error (#1327). Localised Pokémon **type** names follow the same model: route every type-filter pill through `getTypeName(type, t)` (`lib/i18n/typeNames.ts`), and a second selector in the same block bans the inline `type.charAt(0).toUpperCase() + type.slice(1)` capitalisation form (#1389 / #1405).

Canonical pattern:

```tsx
const { name: localeName } = useLocalePokemonName(pokemon.speciesId, pokemon.displayName);
// render `localeName`, not `pokemon.displayName`.
```

**Legitimate `.displayName` reads** (annotate with `// eslint-disable-next-line no-restricted-syntax`): passing `displayName` as the fallback *argument* to the hook itself; inside `app/api/**` (server-side, locale-irrelevant). `lib/**`, `scripts/**`, `e2e/**` are outside the rule's glob.

When the call site is inside a `.map()` (hooks can't be called in map callbacks), extract a named sub-component with one hook call per tile — see `SpritePickerTile` in `SpritePicker.tsx` and `KnownPokemonCard` in `KnownPokemonQuiz.tsx`.

**English-leak gate (#1405 lever 1).** `scripts/generate-pseudo-locale.mjs` builds `messages/xx-pseudo.json` (sentinel-bracketed catalogue). Components under test are rendered via `renderPseudo()` (`components/test-utils/renderWithIntl.tsx`); text not in `[...]` and not on the allowlist (`scripts/i18n-leak-allowlist.ts`) is an untranslated English string. Run: `npm run test:i18n-leak`. The allowlist starts wide (#1434 narrows it as strings move into the catalogue).

### Discoverability

Declare-a-discovery-path, reach-existing-users, and mock-up-on-visual-surface-proposals: `ops/standards/conventions.md` → Discoverability. Poke-memory wiring and specifics:

- `ux-advisor` reviews the discovery path on the brief; `code-reviewer` raises an undeclared path as a **Concern** at review time. Surfaces gated behind an existing discoverable action (e.g. a detail view reachable only after tapping a card) are exempt, provided the gating action is itself discoverable. Mock-up requirement (#1500) is owned by `planner` (authoring tickets), the `/batch-issues` exploration brief, and `ux-advisor` (raises a missing mock-up as a **Concern** on the brief).
- **One-shot hint mechanics.** A one-shot contextual hint must use its **own new** `OnboardingFlags` key — never piggyback an already-dismissed flag like `firstVisitOnboardingDismissed`, and never add new content to `FirstVisitOnboardingModal` (every existing user has dismissed it). Add the new key to `DEFAULT_ONBOARDING` (default `false`) and validate it with the `v.x === true` coercion in `validateOnboarding`, so an absent key (= every existing user) resolves to not-seen and the hint shows. The version-based What's-new channel (`WhatsNewIndicator`) targets users-with-history and suppresses first-timers — use it for the batch summary with past-tense copy, never to instruct dismissing a hint. **Verify in a populated existing-user state** (a settings blob predating the change, or the `pasture-progression` / `fsrs-locale-mastery` QA-seed scenario), not only a fresh session.

### Message-catalogue completeness gate

`scripts/lint-i18n.mjs` (`npm run lint:i18n`, part of the `lint` chain) diffs every non-English catalogue (`messages/{ja,zh-Hans,zh-Hant}.json`) against `messages/en.json` and fails on any **missing** or **extra** key in either direction (extra keys are dead-code drift). When adding/renaming a key: add it to `messages/en.json` first, then propagate the same structural change to the three non-English files before committing.

### Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- Read-your-own-writes after a Server Action mutation: `updateTag(tag)` (Server Actions only).
- Background SWR-style invalidation from Route Handlers: `revalidateTag(tag, 'max')` (the single-arg form is deprecated and a TS error).
- `revalidatePath('/path')` only for path-level data, not specific tags.
- Tag underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions — without that, `updateTag` has nothing to invalidate.

### Superuser mode (READ when adding user-facing features)

A QA cheat unlocked by typing `super` (desktop) or 7-tapping the nav title (mobile). It only reveals a **Developer** section on Settings that houses per-axis-of-cheating flags:

| Flag | Purpose |
|---|---|
| `pretendAllMastered` | Renders every species as mastered across Pokédex, Pasture, Stats, theme picker. |
| `forceNextStreakMilestone` | Fires the smallest un-seen streak celebration on next Practice visit. Self-clears after one fire. |
| `forceCardsGraduated` | Treats all cards as graduated; skips the learning phase. QA typed-entry without grinding. |
| `qaSeedMode` | Reveals a scenario picker (#1326). Pick a scenario, "Apply seed" injects deterministic test data into IndexedDB. Local-only; sync write-guard applies. |

QA-seed scenarios (when `qaSeedMode` on): `fsrs-locale-mastery`, `optimiser-stress`, `pasture-progression`, `mastery-gaps` — details in `lib/qa-seed/scenarios.ts`. Clear via "Clear seed" + reload, or by locking superuser mode.

**Every new user-facing feature must honour the relevant flag.** If a feature shows mastery state, completion counts, per-Pokémon collection state, or anything gated on mastery, read `useSuperuser().flags.pretendAllMastered` and treat as fully mastered when on. Canonical pattern `forceAllMastered || isMastered(...)`; pure functions take an optional `forceAllMastered` param (`computeStats`, `computeRecords`, `filterMastered`). Do **not** add a per-page toggle that re-derives mastery. If a feature genuinely should not be affected, call it out in the PR description and the planner's acceptance criteria.

**QA-seed data must be a faithful proxy for real data.** A fixture that can occupy states real data can't reach (or misses states it does) validates nothing and ships QA-only crashes (#1394 had two). Rules: match every real invariant (unique numeric `id` per session, FSRS states within reachable bounds, name+reverse pairing per #1234, locale consistency); prefer *deriving* states by replaying real grades through `lib/srs/scheduler.ts::nextReview` + the real `hydrateSession` path over hand-fabricating FSRS literals (rebuild tracked in #1421); enforce with forcing functions — `lib/qa-seed/scenarios.test.ts` asserts unique card ids; add `hydrateSession`→`buildSessionQueues` no-throw + FSRS-bounds/pairing assertions as the seed grows.

**Sync write-guard.** While any flag is on, all cloud writes are suppressed (`usePerGradeSync.enqueueGrade`, `useSyncOnUnload`, `AutoSyncOnChange` short-circuit via `null` client/userId; the FSRS optimizer button and the `SyncStatusLine` Retry link render disabled with a "Sync paused (superuser)" label). Any future write-triggering button takes the same `superuserPaused` prop. Background pulls (`SyncOnVisible`, `SignInPull`) stay enabled — reads can't corrupt the cloud. Do not work around this guard.

**Exit cleanup.** When the last flag is toggled off (or the chord re-locks while flags were on), `SuperuserContext` runs `exitCleanup`: signed-in → force-pull cloud, overlay local via `mergeCloudIntoLocal`, dispatch a synthetic `StorageEvent`; guest → `window.confirm` offers a destructive local reset. Don't skip the prompt or the pull.

### Sync (READ FIRST when touching `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`)

Canonical reference: **[docs/sync.md](docs/sync.md)** — read before touching anything that pushes to Supabase. Headline rules:

- **Pull before push.** Any orchestrator merging cloud and local cards pulls and merges before pushing; if `pullSession` fails, do not push. Pushing on stale local state wiped 2497 of 2513 cloud rows (#293). The push-only retry path (`useRetryPush`) is the deliberate exception.
- **`card_reviews_reject_regression_trigger`** (migration 002, extended 015/016/017) blocks regressions at the DB layer — lifecycle timestamps, monotonic `reps`/`lapses`, same-date `scheduled_days` drops, one-way `seen_in_pasture`. Don't work around it. Only `reset_all_progress` (migration 018, SECURITY DEFINER RPC) bypasses the per-column guards.
- **Cards are the primary contract.** Per-grade upsert + unload beacon drive the user-visible sync status. Every other leg (`pushSettings`, `pushStreak`, `pushGradeLog`, `pushRegionalPrefs`, the regional-prefs leg in `pullAndMerge`) is best-effort: `console.warn` and continue, never flip the overall sync into error.
- **No PITR yet** (#298). Treat any production sync change as one-way until PITR is enabled.

### Adding a feature that needs to persist data

Decision tree (JSONB on `user_settings` vs. column on `card_reviews` vs. new table) + new-table checklist (uuid PK, FK to `auth.users` `ON DELETE CASCADE`, SELECT + INSERT RLS as the append-only baseline, indexes, regression-trigger pattern): **[docs/persistence.md](docs/persistence.md)**. For card-shaped persistence keyed by `(user_id, card_type, subject_key)`: **[docs/card-identity.md](docs/card-identity.md)**. Tables today: `card_reviews`, `streak_days`, `user_settings`, `grade_log`.

Two runtime reminders:

- **Apply the migration BEFORE merging the PR** (deadline is merge, not open). `migration-check.yml` fails the required check until file-vs-applied parity holds — call `mcp__supabase__apply_migration(name, query)` (name is the form *without* the `0NN_` prefix).
- **Wire cross-device sync** by adding `lib/sync/<feature>.ts` exporting `push` / `pull` (+ `merge` when applicable). Plumb pull into `pullAndMerge` as a best-effort leg; plumb push wherever the feature's data is written (a new `AutoSyncOnChange` handler, or alongside the existing `saveX(...)`).

### Page params

- `params` and `searchParams` are `Promise` — always `await` them. Synchronous access is fully removed.
- Prefer the generated `PageProps<'/path/[seg]'>` helper after `next typegen` / first dev / first build. The manual inline `params: Promise<{ slug: string }>` always works without that step.

### PokéAPI integration

- **Seed at build time, not request time.** A one-off seed script fetches `/pokemon-species` (master list) → `/pokemon/{id}` (sprites) → `/pokemon-species/{id}` (display name + chain URL) → `/evolution-chain/{id}` (deduped) into a local store. The Pokédex never hits PokéAPI at runtime.
- **Canonical set is `/pokemon-species`** (~1025 species), not `/pokemon` (~1300+ incl. Megas/regional/Gigantamax at IDs 10001+). Resolve each species to `varieties[0]`.
- **Display name** is `pokemon-species.names[]` filtered to `language.name === "en"`. The `/pokemon` `name` field is a kebab-case slug.
- **Default sprite**: `sprites.other["official-artwork"].front_default`, falling back to `sprites.front_default`. Sprites self-hosted under `public/sprites/pokemon/`.
- **Evolution chains are trees** — `evolves_to[]` may branch (Eevee → 8). Walk recursively.
- **Rate limit** ~100/min: cap concurrency at ~20–30, don't aggressively retry on 429.

### Sprite rendering

Canonical reference: **[docs/sprites.md](docs/sprites.md)**. Headline rules:

- **Default to `next/image`.** The only exemption is the Pokédex grid (`PokedexGrid.tsx`), which keeps a plain lazy `<img>` to avoid per-cell wrapper overhead across ~1025 tiles.
- **`/_next/image` is NOT used for sprites.** A global custom loader (`lib/sprites/imageLoader.ts`) redirects sprite paths to pre-generated static WebP under `public/sprites/pokemon/webp/`. Run `npm run seed:sprites` after adding a size constant.
- **Sprite sizes are named constants in `lib/sprites/sizes.ts`** — never inline a pixel literal; it must match the painted CSS size or the wrong WebP variant ships.
- **`priority` is for the above-the-fold focal sprite only.** Off-screen / list-tile sprites stay lazy.

### Spaced repetition

Canonical reference: **[docs/srs.md](docs/srs.md)**. Headline facts:

- **Grading**: `Again` (1) / `Hard` (2) / `Good` (4) / `Easy` (5), mapped to FSRS's `Rating` enum at the boundary in `lib/srs/scheduler.ts`.
- **Mastery**: `reps >= masteryRepetitions && scheduledDays >= 21`.
- **Dates**: scheduling-internal dates (`due_date`, `last_review`, `first_seen`, `scheduled_days` arithmetic) are `"YYYY-MM-DD"` UTC strings — string-comparable, DST-safe via millisecond arithmetic. User-facing day boundaries (today / streak / daily cap) are timezone-aware via `todayInTimezone(tz)` + `user_settings.timezone` (migration 019). Pass the user's tz through display/daily-cap code; stay UTC inside the scheduler.
- **Scheduler is pure**, in `lib/srs/`. `nextReview(state, grade, now, options?)` is the single chokepoint reading `retentionTarget`.

### Testing

Generic testing discipline (test in/out of every state, verify by running the app not just green CI, de-flake in the FULL suite not file-alone, coverage ratchets upward only, absence-only is insufficient): `ops/standards/conventions.md` → Testing discipline. Poke-memory tooling below.

**Unit / component (vitest).** Two projects in `vitest.config.ts`, partitioned by directory: the **`node`** project (`lib/**/*.test.ts(x)`, env `node`, pure logic) and the **`jsdom`** project (`components/**/*.test.tsx`, `app/**/*.test.tsx`, env `jsdom` + `vitest.setup.ts`, all React rendering). A hook can live in `lib/`, but a test calling `renderHook` must live under `components/` or it fails in CI with `ReferenceError: document is not defined`.

**De-flake run (full suite).** Re-run the whole project (`npx vitest run --project <node|jsdom>`) and ideally the changed-files run (`npx vitest run --project <proj> --changed origin/qa`), not the single file. Worked example: the #1464 `PwaInstallNudge` de-flake (PR #1469: `act()` + `getByText`) passed file-alone but deterministically broke the `test` job in the full-suite / `--changed` run (`getByText` has no retry, so it hard-failed against the component's async mount render) and had to be reverted (#1470).

**Integration (vitest + local Postgres).** `lib/sync/integration/` runs against a local `postgres:15` container — no Supabase Pro/branch quota (#464 / #545 replaced PR #531's branching approach). Opt-in locally: `VITEST_INTEGRATION=1 npm run test:integration`. CI's `integration-tests.yml` runs on PRs touching `lib/sync/**`, `app/api/sync/**`, `db/migrations/**`, `lib/gradelog/**`, or itself (#611); the `integration-tests` label is the escape hatch. In scope: `apply-migrations.test.ts`, `rls.test.ts`, `regression-trigger.test.ts`. `auth.uid()` is polyfilled via `SET LOCAL "request.jwt.claims"` in a transaction.

**Coverage gate (#824).** `npm run test:coverage` runs the fast suite under v8 with two gates: a **global floor** in `coverage-floor.json` (the single source of truth — do not hardcode the numbers elsewhere; ratchet *upward* only, never lower to make a build pass; #1333), and **diff coverage** (`scripts/diff-coverage.mjs`, 90% patch bar on changed product lines, excludes test files / generated seed / non-product dirs). Both run in the `coverage` workflow on every PR.

**E2E (Playwright).** Smoke tests in `e2e/` run against Vercel previews via `e2e.yml`; config in `playwright.config.ts`.

- **Scope**: guest-mode only. **Projects**: `chromium` + `mobile-safari` (Webkit, iPhone 14 viewport). **Base URL**: `PLAYWRIGHT_BASE_URL`. **Run locally**: `npm run test:e2e` (after `npx playwright install`).
- **Node version must match CI** (Node 24, baked into `mcr.microsoft.com/playwright:v1.60.0-noble`). Run `nvm use` (`.nvmrc` pins the recommended e2e Node 24; `package.json` `engines.node` is a deliberately looser `>=20` floor). Running under Node 26 produces local-only failures (#657 / #614).
- **Selectors**: prefer `getByRole` / `getByText` / `getByLabel` over CSS or test IDs; match the accessible names in the markup.
- **When to add**: any new page, new interactive flow, or change to an existing user-facing flow. Bar is smoke-level happy path. An absence-only suite (asserting the feature is hidden/disabled/absent) is **not** sufficient — at least one test must assert the feature renders and its core interaction succeeds. One spec file per feature area.

**Mandatory coverage rules (state and locale).** The generic state-coverage and verify-by-running-the-app rules are in `ops/standards/conventions.md` → Testing discipline; here they are non-negotiable for every user-facing change in the implementer's unit/component **and** e2e tests and re-checked by the orchestrator at close-out (#1302 / #1327 shipped three broken headline behaviours that passed unit tests, CI, and review). Poke-memory drivers and the locale matrix:

- **State coverage — test IN and OUT of every state** (on/off for every flag/setting/mode, signed-in vs guest, and **empty vs populated data** — the empty / all-caught-up branch is where regressions hide). When a fresh preview can't reach a data-dependent state, drive it via QA-seed scenarios (#1326) or superuser flags. Verify locale switched, seed applied, empty branch, eyeballing exempted surfaces too (memory: `feedback_verify_core_mechanics_by_running_app`).
- **Locale coverage — test names and labels in EVERY supported locale** (`en`, `ja`, `zh-Hans`, `zh-Hant`) on every surface that renders them, for both axes (`appLocale` for chrome, `pokemonNameLocale` for names). This **includes allowlisted / perf-exempted surfaces** (e.g. the Pokédex grid): lint-rule exemption (#1327) is not render-correctness exemption — add a locale-rendering test there too and resolve names via the pure resolver `lib/pokemon/localeNames.ts::getLocaleName`.
- **Localising a number can break a `\d+` assertion.** Numbers rendered via `Intl.NumberFormat` / next-intl `useFormatter().number()` / an ICU `#` gain locale digit-grouping (`26,645`, or a narrow-NBSP separator). Update any unit/e2e assertion matching the raw number with `\d+` to tolerate the separator, and grep `e2e/` + tests when touching number rendering (#1408).

### Local development gotchas

`localhost:3000` and `pokememory.com` are different origins → independent `localStorage`; state does not flow between them. When behaviour differs between local dev and the deployed app, suspect localStorage drift first — clear the `poke-memory:*` keys and reload, or QA against the latest preview URL.

**Build needs Node 24.** The repo pins Node 24 (`.nvmrc`); `.npmrc` `engine-strict` + a `prebuild` guard fail-fast on the wrong major (#1493). A different machine-default major (e.g. Node 26, which breaks the esbuild-wasm/Turbopack build) silently runs the wrong version unless `.nvmrc` is honoured. Use the pinned 24 for every `npm run build`/test — `nvm use`, or a Homebrew `node@24` on `PATH` — and brief sub-agents the same (they inherit the machine default, not `.nvmrc`).

Two card-mix shapes look "broken" on a fresh dev session but aren't:

- **"Unlimited reviews."** `buildSessionQueues` (`lib/review/session.ts`) only counts a review toward `reviewsDoneToday` when `lastReview === today && firstSeen !== today`. Cards first seen today never count, so the 100/day soft wall can't fire on a session built from cleared localStorage — total grades are bounded by the new-card caps (10 name + 5 evo + 10 reverse + 10 cry) × learning-step replays. The wall fires once prior-day cards come due.
- **Evolution cards inherit the pre-evo's types for scope matching (#426).** `cardMatchesScope` (`lib/review/scope.ts`) resolves `card.preEvoId` to its `SeedPokemon.types`. A Fire scope includes `Charmander → Charmeleon` but excludes `Eevee → Flareon`. Both forward and reverse evo cards anchor all three axes on the pre-evo.

### Documentation

README / CHANGELOG / AGENTS roles (and update-inline-in-the-landing-commit): `ops/standards/conventions.md` → Documentation. Poke-memory canonical references:

- **WORKFLOW.md** — process map: sub-agent roster, orchestration playbook, GitHub Actions catalog, issue lifecycle, branching model, release mechanics, build gates, retrospectives.
- **AGENTS.md** (this file) — implementer conventions index.
- **`docs/*.md`** — canonical references for heavy subsystems ([sync](docs/sync.md), [persistence](docs/persistence.md), [card-identity](docs/card-identity.md), [srs](docs/srs.md), [sprites](docs/sprites.md)).

### Spelling

Spelling: British English. See `ops/standards/conventions.md` → Writing. Poké-specific out-of-scope identifiers to leave alone: PokéAPI fields, FSRS (`optimizer`), shipped Supabase column names.

### Punctuation

Punctuation: see `ops/standards/conventions.md` → Writing — punctuation.

### Screenshots

The README shows six screenshots (`docs/screenshots/{practice-front,practice-flipped,pokedex-grid,pasture,stats,journey}.png`), all captured at the **iPhone 17 Pro viewport** (402×874 CSS px @ 3× DPR). Script: `scripts/capture-screenshots.mjs` (`npm run screenshots`).

**Rule.** When a change visibly affects any of those six surfaces (`app/page.tsx`, `app/pokedex/**`, `app/pasture/**`, `app/stats/**`, `app/journey/**`, or a rendered `components/**`), regenerate the affected screenshot(s) and commit them in the same PR. **macOS only** — CI does not regenerate (Linux font anti-aliasing differs).

```bash
npm run dev &                          # in another terminal / background
npm run screenshots                    # all six
npm run screenshots -- --page=pasture  # one surface
```

A deterministic lived-in seed (`scripts/screenshot-seed.mjs`, #1296) makes renders reproducible. Don't change the viewport, DPR, or surface list without regenerating every screenshot in the same commit.

**Animations.** `npm run animations` (`scripts/capture-animations.mjs`) produces the card-flip GIF (`docs/screenshots/practice-cardflip.gif`), same seed/viewport, macOS only, requires ffmpeg. Each animation file must stay under **4 MB**.

### Versioning

SemVer, `package.json`-as-single-source, changelog fragments, owner-approval for a non-patch bump: `ops/standards/process.md` → Versioning & release. Poke-memory wiring: the daily `auto-release.yml` cron assembles `changelog.d/unreleased/*.md` fragments (`kind: minor-bump` → minor; otherwise patch) and tags; a `minor-bump` fragment needs the owner-applied `version-bump:approved` label (`version-bump-gate.yml`). Fragment format and the full release pipeline (cut-release, loop-break, bot bypass-actor prerequisites) live in [WORKFLOW.md](WORKFLOW.md) and `changelog.d/README.md`.

### Branching model

Two-long-lived-branch model (#806), the `main`-only-from-`qa` rule, and the `qa`-doesn't-auto-close-issues behaviour: `ops/standards/process.md` → Branching model. Full diagram and rulesets in [WORKFLOW.md](WORKFLOW.md). Poke-memory specifics: the source-gate check is named `Restrict main PR source` (overridden by the owner-applied `hotfix` label); `qa`'s required checks are `test` + `e2e` (no strict-up-to-date); every PR-producing path (`/batch-issues`, the `auto` pipeline, one-off features) targets `qa`.

### Stack decisions

Stack/vendor screening (`[USER-DECISION]`, default-to-blocker, no-beta, single-vendor): see `ops/standards/conventions.md` → Stack / vendor screening. Poké-specific: plan persistence shape for plausible future scope (per-card analytics, friends/social).

### Backlog / process

Backlog priority labels + user-owns-priorities, and the generic pre-PR gate (lint+typecheck+build+test+coverage, two-attempt budget, auto-review on PR open, CI-that-doesn't-converge triage) and pre-push spelling check: `ops/standards/process.md` → Backlog & priorities + The pre-PR gate. Full process map (Actions catalog, issue lifecycle, scope warnings, graceful-exit/WIP salvage, retrospectives): [WORKFLOW.md](WORKFLOW.md). Poke-memory runtime specifics:

- The orchestrator usually starts with `gh issue list --label "priority:now"`. Reference the closed issue in the commit (`closes #N`).
- **Pre-PR build gate (exact command).** After pushing, run `npm run lint && npm run typecheck && npm run build && npm test && npm run test:coverage`. `npm run lint` is part of the gate: lint errors (e.g. a `no-restricted-syntax` ban) do **not** surface in typecheck/build/test, so omitting it ships a red PR (#1541). On failure, apply a targeted fix and retry up to twice; after the second failure post the last 80 lines of output and stop without opening a PR. For per-diff coverage locally, pipe a diff into the script while `coverage/coverage-final.json` is still present: `git diff origin/qa...HEAD | node scripts/diff-coverage.mjs`.
- **Pre-PR e2e smoke** for high-surface-area diffs (touching `app/layout.tsx`, `app/page.tsx`, `components/onboarding/**`, `components/Nav.tsx` / `BottomTabBar.tsx` / `MobileNavPaddingWrapper.tsx`, `lib/settings/persistence.ts`, or `playwright.config.ts`): run `scripts/pre-pr-smoke.sh` (chromium-only subset in the pinned Docker image). Same two-attempt budget.
- **Push with an explicit `git push origin <branch>` — never a bare `git push`.** A worktree created via `git worktree add -b <branch> origin/qa` sets the branch's upstream to `origin/qa`, so a bare `git push` does NOT update `origin/<branch>`: at best it fast-fails (rejected, harmless), and at worst it silently pushes to `origin/qa` or no-ops, leaving the PR branch stale and CI red on the old commit — the dangerous case the incident hit. Always name the remote and branch: `git push origin <branch>` (mirrors the `gh pr create --head <branch>` rule). Worked example: a pseudo-locale regen "pushed" but never landed on the PR branch (#1474).
- **Auto-review on PR open.** `auto-review.yml` runs `code-reviewer` automatically (cross-checking the diff against the linked issue's acceptance criteria); do **not** run `code-reviewer` yourself in the implement stage. For CI that doesn't converge, use `/investigate-ci-failure` (logic-vs-perf triage, Playwright traces for perf shapes, read the production path for logic shapes; #1234 / #1263).
- **Planner pre-flight checks** (AC-quality #1321, staleness #1322, testability + first-contact UX #1276) and the **mini-batch after preview QA** / **end-of-session retro** (#1333) flows are owned by `.claude/agents/planner.md` and the `/batch-issues` skill — see those defs for the runbooks.

### Privacy

Two paths with different constraints.

**Guest** — all card/session data stays in the browser (localStorage), never transmitted to a server we control. Sprites are self-hosted static files. Vercel Analytics + Speed Insights collect anonymous aggregate page-view metrics and Core Web Vitals only (no card progress or PII); both render unconditionally in the root layout.

**Authenticated (Supabase sync)** — on GitHub sign-in, per-card FSRS review history is stored in Supabase Postgres. We **are a data controller**: GDPR/UK-GDPR applies (privacy notice, lawful basis, Supabase standard DPA). RLS ensures each user reads/writes only their own rows. Supabase is the sub-processor for authenticated data (Vercel Analytics a second sub-processor for aggregate telemetry). Sign-out does **not** clear localStorage — local data is preserved so users can continue as guests.
