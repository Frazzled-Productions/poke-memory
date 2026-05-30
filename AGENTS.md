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

## Sub-agents and orchestration

Custom agents live in `.claude/agents/`. The full roster, when to use each, and the standard plan → research → implement → E2E → review playbook are in [WORKFLOW.md](WORKFLOW.md#sub-agent-roster).

**Issue-first rule.** Every non-trivial change must have a GitHub issue before implementation begins. Create one if it doesn't exist. PRs reference the issue (`closes #N`) so work is tracked on the project board.

**Issue-body cross-check (implementer-side).** Every coder sub-agent (`ui-coder`, `data-coder`, `playwright`) runs its own `gh issue view` against the linked issue before writing code, enumerates the issue's acceptance criteria, and compares them against the orchestrator's brief. If the brief omits one or more criteria, the coder stops and reports the gap rather than implementing only what the brief covered. The orchestrator either confirms the omission as a deliberate deferral (recorded in the PR body under `## Acceptance criteria covered`) or extends the brief. This is the implementer side of the partial-scope guard introduced after #1259 / #1260, where the orchestrator dropped acceptance criteria from the brief and the gap shipped because no later step re-read the issue. See `.claude/agents/data-coder.md`, `.claude/agents/ui-coder.md`, and `.claude/agents/playwright.md` for the step-1 wording each agent runs.

**Briefs may extend, not contract.** The cross-check is one-directional: a brief that adds detail beyond the issue body is fine — proceed against the brief. A brief that drops scope present in the issue body is the failure mode the check exists to surface. Coders propagate dropped scope to the orchestrator as a question, never silently.

**Skip sub-agents** for small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value. Seeing when to skip is part of the practice.

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
| `README.md`, `CHANGELOG.md` | orchestrator — updated inline as part of each commit, no specialist agent |
| `e2e/**` | playwright |
| `.github/workflows/**` | workflow-expert (review); orchestrator (edits) |
| `.claude/agents/**` | workflow-expert (review); orchestrator (edits) |

**Cross-layer fixes.** The table above is the default routing, not a hard wall. When a `ui-coder` finds the root cause is in `lib/` (or a `data-coder` finds the visible bug is in a component), it is OK to touch the helper as part of the same change — prefer the cleanest layering over strict ownership. The alternative (a page-layer workaround that papers over a `lib/` bug) is the failure mode this carve-out exists to prevent. Document the cross-layer touch in the PR description so the reviewer sees why ownership bent. (See #1125 for the discussion, and #1117 / #1121 for the worked example.)

## Conventions

These are decisions made through deliberate research/discussion, not guesses. Add to this section only when a real decision is locked in.

### Single source of truth for shared concepts

When the same domain concept appears at multiple call sites — Pokémon names rendered in UI, dates formatted for display, sprite URLs resolved, mastery counted, locale-aware text, accessibility attributes attached, class-name literals reused — **every site routes through ONE shared helper, hook, or component**. Never duplicate the logic site-by-site, even if "it's just a one-liner here". The fragmentation pattern is the failure mode this rule prevents.

**Why this is load-bearing.** The #1259 / #1260 multi-locale rollout shipped repeated rounds of partial fixes (#1311 → #1318 → audit-fix) because Pokémon names were rendered directly via `.displayName` in many separate components (`PokemonCard`, `EvolutionCardLayout`, `EvolutionCard`, `SpritePicker`, `MultipleChoiceNameCard`, …). Each render became a separate locale gap and each fix only exposed the next site that hadn't been audited. With a single `useLocalePokemonName(id, fallback)` hook used everywhere, the locale switch (or any future re-styling, accessibility attribute, or A/B test) would live in ONE place and adding locale support would have been one helper edit plus a mechanical import across the call sites.

**How to apply.**

- **Before writing a new render or computation**, ask: "is this concept already produced somewhere? If yes, can I import from there?" If no but the concept is rendered elsewhere, **centralise the existing call sites in the same PR**, rather than adding another fragmented call site.
- **When adding a cross-cutting concern** (locale, theme, accessibility attribute, analytics tag) to the codebase, the first step is to centralise the existing call sites, then add the new concern in the helper. Adding the concern alongside the existing fragments is the failure pattern.
- **When reviewing a PR**, flag any new direct field access on a domain object (`p.displayName`, `card.name`, `pokemon.sprite`) that should go through a helper — `code-reviewer` raises this as a **Blocker** tagged "fragmentation".
- **When orchestrating**, if a brief mentions a domain concept (Pokémon name, date display, mastery count), include a "centralisation check" in the brief: identify the existing helper, or propose a new one with the existing call sites to centralise.

**Existing helpers — use these, do not re-derive.**

- `useLocalePokemonName(id, fallback)` from `lib/i18n/useLocalePokemonName.ts` — Pokémon name rendering (locale-aware).
- `formatDate(iso, fmt, tz)` and `formatShortDate(iso, fmt)` from `lib/utils/format-date.ts` — user-facing date display. `todayInTimezone(tz)` for the current day boundary. `isoDate(d)` for the scheduling-internal `"YYYY-MM-DD"` form.
- `isMastered(state, masteryRepetitions)` from `lib/stats/derive.ts` — single mastery check.
- `filterMastered(cards, …)` from `lib/pasture/arrivals.ts` — mastery filter that honours the superuser `forceAllMastered` axis.
- `computeStats(…)` from `lib/stats/derive.ts` — aggregate stats with the same superuser axis.
- `masteredSpeciesIds(…)` from `lib/badges/derive.ts` — mastered species set.
- `useCardClass(…)` from `lib/review/useCardClass.ts` — card-class derivation.
- Class-name constants in `lib/utils/class-names.ts` — `cardPanel`, `cardPanelPadded`, `colStack`, `colStackLg`, `sectionLabel`, `dialogPanel`, `statValue`, `chartTickText`, `mutedText`. Never inline the underlying Tailwind literal — import the named constant so a visual convention change lives in one file.

**Trade-off.** A premature abstraction is worse than three similar lines. The rule is *don't fragment what's already shared*, not *abstract every duplication*. Three sites with the same pattern that aren't going to grow are fine; three sites that ARE going to need a cross-cutting change next month must share a helper now. Where the failure mode is easy to encode at PR time, prefer a lint rule (see #1327 for the Pokémon-name case) over a convention-only enforcement.

**Every single-source helper ships with a forcing function.** A convention that relies on reviewer vigilance fragments eventually (the #1259 / #1369 i18n surface misses; the recurring "discovered another surface later" pattern). When you centralise a concept into a helper, also add a mechanism that makes a bypassing call site fail CI — not just a line in this file:

- a **lint rule** banning the raw form the helper replaces (model: the #1327 `no-restricted-syntax` rule that bans raw `.displayName` reads, forcing `useLocalePokemonName`), and/or
- a **fitness / contract test** asserting the invariant holds across all sites (model: the #1356 onConflict↔PK parity test, which fails if any client upsert's conflict columns drift from the table constraint — note this is a non-i18n example, the pattern is general), and/or
- **type-system forcing** that makes the raw form un-representable or requires the cross-cutting argument (model: `computeStats(…, forceAllMastered)` — you cannot construct the call without considering the superuser axis).

A helper that is convention-only (documented here but unenforced) is a latent fragmentation site. The enforcement-gap candidate list (class-name constants, sprite-size constants, date formatting, `forceAllMastered` honoring, type labels) and the i18n English-leak gate are tracked in #1406 / #1405.

### Multi-locale rendering

All Pokémon names shown to users must flow through `useLocalePokemonName(speciesId, fallbackName)` from `lib/i18n/useLocalePokemonName.ts`. A lint rule (`no-restricted-syntax` in `eslint.config.mjs`, covering `components/**` and `app/**` minus `app/api/**`) enforces this at PR time — direct `.displayName` reads in those trees are a CI error (#1327).

**The canonical pattern:**

```tsx
const { name: localeName } = useLocalePokemonName(pokemon.speciesId, pokemon.displayName);
// Then render `localeName`, not `pokemon.displayName`.
```

**When `.displayName` reads are legitimate** (and must be annotated with `// eslint-disable-next-line no-restricted-syntax`):

- Passing `displayName` as the English-fallback *argument* to `useLocalePokemonName` itself — the hook uses it as a synchronous fallback, not as the final render value.
- Inside `app/api/**` — server-side API routes where locale is irrelevant and the English baseline is correct.
- Inside `lib/**`, `scripts/**`, `e2e/**` — these are excluded from the rule's file glob.

When extracting a sub-component to use the hook (required when the call site is inside an array `.map()` — hooks may not be called inside map callbacks), follow the pattern in `SpritePicker.tsx` (`SpritePickerTile`) and `KnownPokemonQuiz.tsx` (`KnownPokemonCard`): one hook call per rendered tile, inside a named component.

### Message-catalogue completeness gate

`scripts/lint-i18n.mjs` (run via `npm run lint:i18n`) diffs every non-English catalogue (`messages/{ja,zh-Hans,zh-Hant}.json`) against `messages/en.json` as the structural baseline. The check fails (exit 1) when any locale is **missing** a key that `en` has, or has an **extra** key that `en` doesn't — both directions, because extra keys are dead code that signal drift.

The gate is part of the `lint` chain (`eslint && lint:em-dash && lint:i18n`), so it runs automatically in the `test` CI job on every PR via `npm run lint`. No extra workflow step is needed.

**When adding or renaming a message key:** add it to `messages/en.json` first, then propagate the same structural change to the three non-English files before committing. Running `node scripts/lint-i18n.mjs` locally verifies parity without waiting for CI.

### Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- For read-your-own-writes after a Server Action mutation (e.g. user grades a card → must immediately see updated state), use `updateTag(tag)`. Server Actions only.
- For background SWR-style invalidation from Route Handlers, use `revalidateTag(tag, 'max')`. The single-argument form is deprecated and produces a TS error.
- Use `revalidatePath('/path')` only when invalidating path-level data, not specific tags.
- Tag the underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions — without that, there is nothing for `updateTag` to invalidate.

### Superuser mode (READ when adding user-facing features)

Superuser mode is a QA cheat unlocked by typing `super` (desktop) or 7-tapping the nav title (mobile). It does **not** itself change behaviour — it reveals a **Developer** section on the Settings page that houses per-behaviour flags.

**Flags are per axis of cheating, not per page.** Flags currently in use:

| Flag | Purpose |
|---|---|
| `pretendAllMastered` | Renders every species as mastered across Pokédex, Pasture, Stats, and the theme picker. |
| `forceNextStreakMilestone` | Fires the smallest un-seen streak celebration on next Practice visit. Self-clears after one fire. |
| `forceCardsGraduated` | Treats all cards as graduated; skips the learning phase. Use to QA typed-entry without grinding. |
| `qaSeedMode` | Reveals a scenario picker in the Developer section (#1326). Select a scenario and click "Apply seed" to inject deterministic test data into IndexedDB. Local-only — sync write-guard applies. See below for the scenario list. |

Do **not** add a per-page toggle that re-derives mastery — wire the page into `flags.pretendAllMastered` instead.

**QA seed scenarios** (available when `qaSeedMode` is on): `fsrs-locale-mastery` — 30 mastered en-locale name cards + due-soon + in-learning; switch Pokémon name language to Japanese to verify locale-aware mastery reset. `optimiser-stress` — 20 heavily-reviewed cards + 2 single-review cards; run the FSRS optimiser from Settings to verify it returns weights. `pasture-progression` — 40 mastered + 20 in-progress + 15 in-learning species; visit Pasture for a realistic populated view. `mastery-gaps` — reviewed-but-unmastered species (high reps, short scheduled days) + name-mastered-but-reverse-pending species; visit Pasture "Next arrivals" and Journey "Close to mastery" to verify both sections populate correctly. To clear seeded state: click "Clear seed" and reload, or lock superuser mode (which offers to restore cloud state for signed-in users, or reset local state for guests).

**Every new user-facing feature must honour the relevant superuser flag.** Specifically: if a feature displays mastery state, completion counts, per-Pokémon collection state, or anything gated on having mastered things, it must read `useSuperuser().flags.pretendAllMastered` (or a future appropriate flag) and treat it as "fully mastered" when on. The canonical pattern is `forceAllMastered || isMastered(...)`; pure functions take an optional `forceAllMastered` parameter (see `computeStats`, `computeRecords`, `filterMastered`).

If a feature genuinely should not be affected (e.g. the all-caught-up Higher-or-Lower minigame samples from real seen-pool, not mastered state), call that out explicitly in the PR description and the planner step's acceptance criterion.

**Sync write-guard.** While any superuser flag is on, all cloud writes are suppressed:
- `usePerGradeSync.enqueueGrade` and `useSyncOnUnload` short-circuit because `ReviewSession.tsx` passes `null` client/userId.
- `AutoSyncOnChange` short-circuits the same way.
- The FSRS optimizer button on the Settings page (`FsrsOptimizerSection`) renders disabled with a "Sync paused (superuser)" label, and the Retry link inside `SyncStatusLine` (Stats page) is disabled with a hover title explaining the pause. Both are visible cloud-write surfaces gated by this guard; any future write-triggering button must take the same `superuserPaused` prop and disable itself when it is true.
- Background pulls (`SyncOnVisible`, `SignInPull`) stay enabled — reads can't corrupt the cloud.

Do not work around this guard. The whole point is that a QA session with cheats on can never leak fake state into Supabase, regardless of which flag is active.

**Exit cleanup.** When the last flag is toggled off (or the chord/tap re-locks superuser while flags were on), `SuperuserContext` runs `exitCleanup`:
- Signed-in: force-pulls cloud and overlays local via `mergeCloudIntoLocal`, then dispatches a synthetic `StorageEvent` so same-tab listeners re-read. This wipes any QA drift in local state.
- Guest: `window.confirm` offers a destructive local-state reset since there is no cloud to fall back to.

Both branches assume the user understands they're exiting a QA mode. Do not silently skip the prompt or the pull.

### Sync (READ FIRST when touching `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`)

The canonical reference is **[docs/sync.md](docs/sync.md)** — read it before touching anything that pushes to Supabase. Headline rules:

- **Pull before push.** Any orchestrator that merges cloud and local cards must pull and merge before pushing; if `pullSession` fails, do not push. Pushing on stale local state is the exact failure mode that wiped 2497 of 2513 cloud rows (#293). The push-only retry path (`useRetryPush`) is the deliberate exception — it never pulls.
- **`card_reviews_reject_regression_trigger` (migration 002, extended in 015/016/017)** blocks regressions on `card_reviews` at the DB layer — lifecycle timestamps, monotonic `reps`/`lapses` counters, same-date `scheduled_days` drops, and the one-way `seen_in_pasture` flag. Do not work around it. The only destructive path that bypasses the per-column guards is `reset_all_progress` (migration 018, SECURITY DEFINER RPC).
- **Cards are the primary contract.** Per-grade upsert + unload beacon drive the user-visible sync status. Every other leg — `pushSettings`, `pushStreak`, `pushGradeLog`, `pushRegionalPrefs`, the regional-prefs leg inside `pullAndMerge` — is best-effort: `console.warn` and continue, never flip the overall sync into the error state.
- **No PITR yet** (#298). Treat any production sync change as one-way until PITR is enabled.

[docs/sync.md](docs/sync.md) covers the active sync paths (per-grade debounced upsert, unload beacon, background pull on visibility, side-channel auto-syncs, failed-beacon retry, and the Stats-page force-pull), the per-card conflict rule, the regression trigger, per-table conflict policy, schema notes for `user_settings` / `card_reviews` / `grade_log`, and catastrophic-recovery posture.

### Adding a feature that needs to persist data

The full decision tree — JSONB field on `user_settings` vs. column on `card_reviews` vs. new table, plus the new-table checklist (uuid PK, FK to `auth.users` with `ON DELETE CASCADE`, SELECT + INSERT RLS policies as the append-only baseline with opt-in UPDATE/DELETE, indexes, regression-trigger pattern) — lives in **[docs/persistence.md](docs/persistence.md)**. Tables today are `card_reviews`, `streak_days`, `user_settings`, `grade_log`.

For card-shaped persistence — anything keyed by `(user_id, card_type, subject_key)` — the decision record (why one table with a discriminator over per-card-type tables, when to add a new `card_type` vs. a sidecar table, subject-key encoding conventions) lives in **[docs/card-identity.md](docs/card-identity.md)**. Read it before adding a new card type or extending the `card_reviews` schema.

Two things to remember at runtime without leaving AGENTS.md:

- **Apply the migration BEFORE merging the PR** (typically right after opening it, but the deadline is merge, not open). `migration-check.yml` fails the required CI check until file-vs-applied parity holds, so the PR cannot merge until you've called `mcp__supabase__apply_migration(name, query)`.
- **Wire cross-device sync** by adding `lib/sync/<feature>.ts` exporting `push` / `pull` (and a `merge` helper when applicable). Plumb the pull side into `pullAndMerge` as a best-effort leg, and the push side wherever the feature's data is written — typically a new handler in `AutoSyncOnChange` listening for that feature's local change event, or a direct call alongside the existing `saveX(...)` write. Auxiliary legs are best-effort — `console.warn` and continue, never flip the overall sync into the error state.

### Page params

- `params` and `searchParams` are `Promise` — always `await` them. Synchronous access from earlier Next.js versions is fully removed.
- Prefer the generated `PageProps<'/path/[seg]'>` helper for page components after `next typegen` / first `next dev` / first `next build` has run. The manual inline `params: Promise<{ slug: string }>` always works without that step.

### PokéAPI integration

- **Seed at build time, not request time.** Run a one-off seed script that fetches `/pokemon-species` (master list) → `/pokemon/{id}` (sprites) → `/pokemon-species/{id}` (display name + chain URL) → `/evolution-chain/{id}` (deduped) and writes a local store. The Pokédex list page never hits PokéAPI at runtime.
- **Canonical Pokémon set comes from `/pokemon-species`** (~1025 species), not `/pokemon` (~1300+ which includes Megas, regional variants, Gigantamax forms with IDs 10001+). For each species, resolve to `varieties[0]` for the primary pokemon record.
- **Display name** lives on `pokemon-species.names[]` filtered to `language.name === "en"`. The `name` field on `/pokemon` is a kebab-case slug, not a display name.
- **Default sprite**: `sprites.other["official-artwork"].front_default`. Fall back to `sprites.front_default` when null. Sprites are self-hosted under `public/sprites/pokemon/` and served as static assets from the same Vercel deployment as the app.
- **Evolution chains are trees**, not lists — `evolves_to[]` may have multiple entries (Eevee → 8 forms). Walk recursively.
- **Rate limit**: ~100/min advised. Seed scripts should cap concurrency at ~20–30 and not aggressively retry on 429.

### Sprite rendering

The canonical reference — `next/image` vs. plain `<img>`, when `priority` / `loading` apply, the `lib/sprites/sizes.ts` size constants, when to use `SpritePreloader` / `decodeSpriteUrls` / `useSpritePrefetch`, the deliberate Pokédex-grid exemption, and the pre-generated WebP delivery model — lives in **[docs/sprites.md](docs/sprites.md)**. Read it before adding a sprite-rendering surface or touching `lib/sprites/` or `components/sprites/`.

Headline rules:

- **Default to `next/image`.** The only exemption is the Pokédex grid (`PokedexGrid.tsx`), which keeps a plain lazy `<img>` to avoid per-cell wrapper overhead across ~1025 tiles — documented inline and in docs/sprites.md.
- **`/_next/image` is NOT used for sprites.** A global custom loader (`lib/sprites/imageLoader.ts`) redirects sprite paths to pre-generated static WebP files under `public/sprites/pokemon/webp/`, bypassing Vercel Image Optimisation entirely. Run `npm run seed:sprites` after adding a new size constant.
- **Sprite sizes are named constants in `lib/sprites/sizes.ts`.** Never inline a sprite pixel literal; the size must match the painted CSS size or the wrong WebP variant is served.
- **`priority` is for the above-the-fold focal sprite only.** Off-screen / list-tile sprites stay lazy; decorative chrome is explicitly `priority={false}`.

### Spaced repetition

The full reference — FSRS algorithm + per-user weights (#268), the Anki-style learning-steps layer with difficulty-based bands, `ReviewState` shape, queue policy, daily limits, card directions (`name` / `reverse` / `cry` / evolution streams), practice scope (`practiceScope` on `UserSettings`), undo, and mastery — lives in **[docs/srs.md](docs/srs.md)**. Read it before touching `lib/srs/`.

Headline facts to keep top of mind:

- **Grading**: `Again` (1) / `Hard` (2) / `Good` (4) / `Easy` (5). The 1/2/4/5 convention maps to FSRS's `Rating` enum at the boundary in `lib/srs/scheduler.ts`.
- **Mastery**: `reps >= masteryRepetitions && scheduledDays >= 21`.
- **Dates**: scheduling-internal dates (`due_date`, `last_review`, `first_seen`, `scheduled_days` arithmetic in `lib/srs/scheduler.ts`) are `"YYYY-MM-DD"` strings in UTC — string-comparable, no timezone math, DST-safe via millisecond arithmetic. User-facing day boundaries (today / streak / daily review cap) are timezone-aware via `lib/utils/format-date.ts::todayInTimezone(tz)` and `user_settings.timezone` (migration 019). When working on display or daily-cap code, pass the user's tz through; when working inside the FSRS scheduler, stay UTC.
- **Scheduler is pure** and lives in `lib/srs/`. `nextReview(state, grade, now, options?)` is the single chokepoint that reads `retentionTarget`.

### Testing

#### Unit / component tests (vitest)

Two vitest projects in `vitest.config.ts`, partitioned by directory:

- **`node` project**: `lib/**/*.test.ts` and `lib/**/*.test.tsx`. Environment `node` — no DOM. Pure-logic tests only.
- **`jsdom` project**: `components/**/*.test.tsx` and `app/**/*.test.tsx`. Environment `jsdom` plus `vitest.setup.ts`. All tests that render React (`render` / `renderHook` from `@testing-library/react`) live here.

A React hook can live in `lib/` (e.g. `lib/review/useStorageQuota.ts`), but if its test calls `renderHook`, the test file must live under `components/` so the jsdom project picks it up. Imports are absolute (`@/lib/...`), so co-locating a hook test next to its source is not required and will fail in CI with `ReferenceError: document is not defined`.

#### Integration tests (vitest + local Postgres)

Integration tests live in `lib/sync/integration/` and run against a local Postgres service container — no Supabase Pro plan or branch quota required. They are opt-in locally: set `VITEST_INTEGRATION=1` and run `npm run test:integration`. In CI the `integration-tests.yml` workflow spins up a `postgres:15` service container and passes `DATABASE_URL` to the test runner. The original Supabase-branching approach (PR #531) was replaced here because Supabase branching requires the Pro plan (#464 / #545).

The CI suite runs automatically on any PR that touches the cloud-write surface — `lib/sync/**`, `app/api/sync/**`, `db/migrations/**`, `lib/gradelog/**`, or `.github/workflows/integration-tests.yml` itself (#611). PRs outside those paths don't trigger it, keeping CI spend bounded. The `integration-tests` PR label remains an explicit opt-in escape hatch for changes that fall outside the path filter but still need DB-level verification, and `workflow_dispatch` covers manual runs. `integration` is not a required check, so non-matching PRs simply don't run it and aren't blocked.

Three tests are in scope: `apply-migrations.test.ts` (all `db/migrations/*.sql` apply cleanly), `rls.test.ts` (user A cannot read/write user B's rows), and `regression-trigger.test.ts` (the `card_reviews_reject_regression_trigger` fires on illegal UPDATEs). All use direct SQL via `pg`; the `auth.uid()` polyfill in `setup.ts` simulates an authenticated session by setting `SET LOCAL "request.jwt.claims"` inside a transaction.

#### Coverage gate (#824)

`npm run test:coverage` runs the fast suite under the v8 coverage provider. Two gates apply:

- **Global floor.** Floor values live in `coverage-floor.json` at the repo root — the single source of truth, imported by `vitest.config.ts` and templated into every PR's coverage comment by `.github/workflows/coverage.yml`. `vitest run --coverage` exits non-zero if overall coverage drops below the floor. Ratchet the floor *upward* as coverage improves — never lower it to make a red build pass. The `/batch-issues` skill ratchets `coverage-floor.json` at the end of every session that touches product code (see its "End-of-session" steps); manual ratchets are also fine. **Do not hardcode the numbers in this paragraph** — point readers at the JSON file instead. The drift that motivated #1333 was four separate copies of the floor (config, two docs files, a workflow comment) that fell out of sync; a single JSON source prevents the recurrence.
- **Diff coverage.** `scripts/diff-coverage.mjs` cross-references the lines a PR adds/changes against the v8 per-statement hit counts in `coverage/coverage-final.json` (the `json` reporter) and requires changed product lines to hit a 90% patch-coverage bar. Lines in test files, the generated seed payload, and non-product directories are excluded; a PR that changes no instrumented product lines skips the gate.

Both gates run in the `coverage` workflow on every PR (see WORKFLOW.md "Build gates"). The coverage step no longer carries `continue-on-error`, so a breach fails the job. The PR comment posts on both pass and fail.

#### E2E tests (Playwright)

Playwright smoke tests live in `e2e/` and run against Vercel preview deployments via `e2e.yml`. Config is in `playwright.config.ts`.

- **Scope**: guest-mode flows only (no auth). Tests verify page loads, navigation, interactive flows (card flip, grade buttons), and key content on each page.
- **Projects**: `chromium` and `mobile-safari` (Webkit with iPhone 14 viewport) — both run in CI.
- **Base URL**: set via `PLAYWRIGHT_BASE_URL` env var (preview URL in CI, `http://localhost:3000` locally).
- **Run locally**: `npm run test:e2e` (requires `npx playwright install` first).
- **Node version**: your local Node must match CI's, or the e2e suite produces local-only failures — running under Node 26 is a known source of these. CI runs inside `mcr.microsoft.com/playwright:v1.60.0-noble`, which ships **Node 24**, so the repo ships an `.nvmrc` pinned to `24`; run `nvm use` (or `nvm install 24`) locally before running the suite. Note that `.nvmrc` pins the *recommended* e2e Node version (24), while `package.json` `engines.node` is a deliberately looser hard floor (`>=20`) so CI jobs that run `npm ci` under Node 20 do not emit engine-unsupported warnings — the two intentionally differ. (Originally investigated in #657.)
- **Selectors**: prefer `getByRole`, `getByText`, and `getByLabel` over CSS selectors or test IDs. Match the accessible names already in the markup (ARIA labels, headings, button text).
- **When to add E2E tests**: any change that adds a new page, a new interactive flow, or modifies an existing user-facing flow should include or update an E2E test in `e2e/`. The bar is smoke-level coverage — verify the happy path loads and key interactions work, not exhaustive edge cases. Absence-only test suites do not satisfy this requirement: a suite that only asserts the feature is hidden, disabled, or absent under various conditions leaves a rendering regression undetected. At least one test must assert the feature actually renders and its core interaction succeeds in the happy path.
- **File naming**: one spec file per feature area (e.g. `e2e/smoke.spec.ts` for cross-cutting smoke tests, `e2e/pokedex.spec.ts` for Pokédex-specific flows).

#### Mandatory coverage rules (state and locale)

Two non-negotiable rules for every user-facing change, enforced in the implementer's own tests (unit/component **and** e2e) and re-checked by the orchestrator at close-out by actually running the app. These exist because the #1302 / #1327 batch shipped three broken headline behaviours (English names on the Pokédex grid, an untranslated UI after switching locale, English picker labels) that all passed unit tests, CI, and code-review — because nothing exercised the feature in the broken state / locale.

- **State coverage — test IN and OUT of every state.** Any change that introduces or gates on a state must be tested in *both* the on and off states, never just the happy one. "State" includes: a superuser / Labs / feature flag (on **and** off), each meaningful value of a setting, a mode (e.g. typed-entry strict/lenient), signed-in vs guest, and **empty vs populated data** (a list or section must be tested both when it has entries *and* when it is empty — the empty / all-caught-up branch is where regressions hide). A suite that exercises only one side of a state does not satisfy this rule. When the state is data-dependent and a fresh preview can't reach it, drive it via the #1326 QA-seed scenarios or superuser flags.

- **Locale coverage — test names and labels in EVERY supported locale.** Any change that renders, formats, or passes through a Pokémon name or a user-facing label/text must be verified in all supported locales — `en`, `ja`, `zh-Hans`, `zh-Hant` — on **every** surface that renders it, for both axes where relevant (`appLocale` for UI chrome, `pokemonNameLocale` for names). This **explicitly includes allowlisted / perf-exempted surfaces** (e.g. the Pokédex grid): exemption from the `.displayName` lint rule (#1327) is **not** exemption from rendering the correct localised value — add a locale-rendering test for the exempted surface too, and resolve names there through the pure resolver (`lib/pokemon/localeNames.ts::getLocaleName`), not the raw English seed field.

- **Verify by running the app, not just green CI.** Unit + e2e green is necessary but not sufficient for core user-facing mechanics. At close-out the orchestrator runs the app (or drives Playwright / the `/verify` skill) in the relevant state — locale switched, seed applied, the empty branch — and eyeballs every affected surface, including the exempted ones, before declaring done. (memory: `feedback_verify_core_mechanics_by_running_app`.)

### Local development gotchas

`localhost:3000` and `pokememory.com` are different origins → independent `localStorage`. State (practice scope, review session, settings, superuser flags) does not flow between them. When a behaviour differs between local `next dev` and the deployed app, suspect localStorage drift before suspecting framework code — clear the `poke-memory:*` keys on the dev origin and reload, or QA against the latest preview URL from `vercel-preview-on-ready.yml`.

**E2E suite fails locally but passes in CI.** The most common cause is a Node version mismatch. CI uses Node 24 (baked into `mcr.microsoft.com/playwright:v1.60.0-noble`). Running `npm run test:e2e` under Node 26 triggers failures that do not appear in CI — the same root cause as the ESLint 10 crash (#614). The fix is `nvm use` (picks up `.nvmrc`, which pins the recommended e2e Node version `24` — note `package.json` `engines.node` is a looser `>=20` floor), then `npx playwright install` once, then rerun. Also verify that your local browser binaries match the pinned `@playwright/test` version in `package-lock.json` — a version mismatch after `npm ci` will produce a "browser is not installed" or silent timing difference.

Two card-mix shapes specifically look "broken" on a fresh dev session but aren't:

- **"Unlimited reviews."** `buildSessionQueues` (`lib/review/session.ts`) only increments `reviewsDoneToday` when `lastReview === today && firstSeen !== today` (i.e. the card was first seen on a previous day). Cards first seen today have `firstSeen === today` set permanently on the first grade, so subsequent grades of the same card never count toward `reviewsDoneToday`. The 100/day review soft wall therefore cannot fire on a session built from cleared localStorage — total grades are bounded by the *new*-card caps (10 name + 5 evo + 10 reverse + 10 cry) multiplied by learning-step replays. The wall starts firing once cards introduced on prior days come due as reviews.
- **Evolution cards inherit the pre-evo's types for scope matching (#426).** `cardMatchesScope` (`lib/review/scope.ts`) resolves `card.preEvoId` to its `SeedPokemon.types` for the type-axis check. A Fire scope includes `Charmander → Charmeleon` (Charmander is Fire) but excludes `Eevee → Flareon` (Eevee is Normal). Both forward and reverse-evolution cards use the pre-evo as the anchor for all three axes (gens, types, presets).

### Documentation

- **README.md** is the user-facing entry point — audience is a curious visitor or contributor. Concise, scannable, includes run-locally instructions.
- **CHANGELOG.md** tracks notable user-facing changes. Loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Add a fragment file under `changelog.d/unreleased/` whenever a commit changes user-facing behavior or adds a feature — **do not edit `CHANGELOG.md` directly** (see `changelog.d/README.md` for the format).
- **WORKFLOW.md** is the process map — sub-agent roster, orchestration playbook, GitHub Actions catalog, issue lifecycle, build gates, and retrospectives. Update it in the same commit that changes a workflow or orchestration behavior.
- **AGENTS.md** (this file) is the implementer conventions index. Internal conventions are kept separate from user-facing docs — don't merge them.
- **Topic files under `docs/`** are the canonical references for the heavy subsystems, kept out of AGENTS.md to keep the always-loaded context small:
  - [docs/sync.md](docs/sync.md) — sync invariants, the four sync paths, per-card conflict rule, regression trigger.
  - [docs/persistence.md](docs/persistence.md) — adding new persisted data: JSONB field vs. column vs. new table, RLS template, migration timing.
  - [docs/srs.md](docs/srs.md) — FSRS scheduler, learning-step bands, `ReviewState`, queue policy, mastery.
  - [docs/sprites.md](docs/sprites.md) — sprite render conventions: `next/image` vs. `<img>`, `priority`/`loading`, size constants, preload/decode-ahead, the Pokédex-grid exemption.
  Update the topic file in the same commit that changes its subsystem; the pointer in AGENTS.md stays short.
- **All of these are updated inline in the commit that lands the change** — no separate docs-only commit, no specialist agent.

### Spelling

All prose written for this project — code comments, commit messages, PR descriptions, docs (`README.md`, `CHANGELOG.md`, `WORKFLOW.md`, `docs/**`, `AGENTS.md`), user-facing UI strings, and error messages — uses **British English** spelling (`colour`, `behaviour`, `optimise`, `serialise`, `centre`).

- **In scope**: prose, comments, commit messages, PR descriptions, docs, user-facing UI copy, error messages.
- **Out of scope**: identifiers from external APIs and standards — CSS (`color`, `text-align: center`), JS/DOM (`Intl.DateTimeFormat`), React props (`onColorChange`), PokéAPI fields, FSRS (`optimizer`), Supabase column names already shipped. Renaming those breaks integrations for no benefit.
- **Internal identifiers**: prefer British (`colour`, `behaviour`) for new code, but don't churn existing identifiers — too noisy, too risky for sync/migration code.

### Punctuation

Do not use em dashes (`—`) in user-facing copy. Restructure the sentence, or replace with a comma, colon, parentheses, or a spaced hyphen (` - `), whichever reads best.

- **In scope**: rendered UI text, button/label text, ARIA labels, `alt` text, `placeholder`/`title` attributes, error messages, page metadata (`<title>`/description), and `CHANGELOG.md` plus `changelog.d/` fragments (fragments become user-visible when a release is cut).
- **Out of scope**: code comments, commit messages, and developer docs (`AGENTS.md`, `README.md`, `docs/**`, etc.) may keep em dashes.

### Screenshots

The README shows six screenshots (`docs/screenshots/{practice-front,practice-flipped,pokedex-grid,pasture,stats,journey}.png`), all captured at the **iPhone 17 Pro viewport** (402×874 CSS px @ 3× DPR) so the README grid lines up uniformly. The capture script is `scripts/capture-screenshots.mjs`, wrapped as `npm run screenshots`.

**Rule.** When a change visibly affects any of those six surfaces — `app/page.tsx` (Practice), `app/pokedex/**`, `app/pasture/**`, `app/stats/**`, `app/journey/**`, or a `components/**` change that the surface renders — regenerate the affected screenshot(s) and commit them in the same PR. **Run locally on macOS only.** CI does not regenerate, because Linux font anti-aliasing differs visibly from macOS Core Text and would clobber every screenshot on every PR.

```bash
npm run dev &                          # in another terminal, or in the background
npm run screenshots                    # all six
npm run screenshots -- --page=pasture  # one surface
npm run screenshots -- --page=journey  # journey surface
```

The script uses a deterministic lived-in seed (`scripts/screenshot-seed.mjs`, Pikachu staged as the practice protagonist via the #1296 approach) so renders are deterministic without depending on a particular review history. Don't change the viewport, the device-scale factor, or the surface list without updating every existing screenshot in the same commit — the README layout assumes consistent shape.

**Animations.** `npm run animations` runs `scripts/capture-animations.mjs` to produce a looping GIF of the practice card flip (`docs/screenshots/practice-cardflip.gif`). The same seed and viewport are used. Requirements: ffmpeg (Homebrew: `brew install ffmpeg`). macOS-only capture — the same font anti-aliasing constraint as the PNGs. Budget: each animation file must stay under **4 MB**.

### Versioning

- **Standard**: SemVer 2.0.0.
- **Pre-v1 semantics**: `0.MINOR.PATCH` for all pre-v1 releases. Bump rules (applied per-release to the set of merged fragments):
  - `kind: minor-bump` fragment present → minor bump (`0.N.0 → 0.N+1.0`)
  - any other non-empty set of fragments → patch bump (`0.N.P → 0.N.P+1`)
  - major (`1.0.0`) remains a manual decision
  - Patch is the default; minor is opt-in via a dedicated `kind: minor-bump` fragment. This preserves PR 230's intent under the fragment-based workflow introduced in PR 234.
  - **Approval gate (`version-bump-gate.yml`)**: a PR that adds a `kind: minor-bump` (or future `kind: major-bump`) fragment fails CI unless it carries the `version-bump:approved` label. Only the repo owner applies that label. Planners and coders **must not** add `minor-bump` fragments without explicit user direction — default to a patch fragment for normal feature work.
- **Cadence: batched, daily.** `auto-release.yml` runs on a daily cron (09:00 UTC) and on manual `workflow_dispatch`, not on every push to `main`. If `changelog.d/unreleased/` contains any `*.md` fragments at trigger time, the workflow assembles them into the next `## [X.Y.Z]` section, bumps the SemVer, commits (deleting the consumed fragments), tags, pushes, and creates a GitHub Release. If no fragments exist, the workflow no-ops. Merged PRs sit on `main` (deployed as preview-equivalents but not promoted to production) until the next cron tick. For hotfixes or same-day shipping, dispatch the workflow manually from the Actions tab. Since Vercel auto-deploys on every push to `main`, "tagged release" and "deployed to production" are the same event in this project.
- **Version source**: `package.json` is the single source of truth. The release workflow bumps it automatically — never edit the version field by hand.
- **Fragment promotion**: when a release is cut, `cut-release.mjs` assembles the fragments into a new `## [X.Y.Z] — YYYY-MM-DD` block inserted after the static `## [Unreleased]` stub in `CHANGELOG.md`, and the release commit deletes all `changelog.d/unreleased/*.md` files. The `## [Unreleased]` heading and its HTML comment remain in `CHANGELOG.md` as a permanent stub.
- **Loop break**: the workflow's own commit is `chore(release): vX.Y.Z [skip ci]`. Since the trigger is now `schedule` + `workflow_dispatch` (not `push`), a release commit landing on `main` cannot re-fire this workflow — the `[skip ci]` marker is defence-in-depth only.
- **Fragment content guidance for contributors**: only add fragments you are happy to ship in the next scheduled release — the daily cron cuts one. Internal-only changes that should not bump the version (e.g. agent-roster tweaks) should not have a fragment at all. The fragment format is:
  ```
  ---
  kind: added | changed | removed | deprecated | fixed | security | minor-bump
  ---
  - Your changelog bullet here.
  ```
  Name the file `<issue-or-pr-number>-<short-slug>.md` and place it under `changelog.d/unreleased/`. See `changelog.d/README.md` for full details.
- **Prerequisite**: the `poke-memory-bot` App must be a bypass actor on **both** the `main-protection` ruleset (ID 16176438) — so its release commit can land on `main` without going through a PR — and the `qa-staging` ruleset — so `auto-release.yml`'s post-release step can force-push the `qa` reset. If `auto-release.yml` ever fails with a protected-branch error on a `git push`, a missing bypass entry is the cause.

### Branching model

Two long-lived branches (#806). The full diagram, rulesets, and rationale live in [WORKFLOW.md](WORKFLOW.md) "Branching model"; the rules an implementer needs:

- **`main`** is strict and production-tracked. It accepts PRs **only from `qa`** — the `Restrict main PR source` required check fails any other PR unless it carries the `hotfix` label (owner-applied; the documented bypass for genuine hotfixes).
- **`qa`** is the integration branch with a relaxed ruleset (required checks `test` + `e2e`, no strict-up-to-date). Every PR-producing path targets `qa`, not `main`: `/batch-issues`, the `auto` pipeline (`auto-issue.yml` opens implement PRs `--base qa`), and one-off feature PRs. `auto-review` runs on those `qa` PRs; `/batch-issues` disables it during its drain and relies on the in-session `code-reviewer` instead. The repo admin role and `poke-memory-bot` are bypass actors on `qa-staging`, so the owner can fast-forward or reset `qa` directly; `main` has no such owner bypass.
- **`/batch-issues`** drains all batch PRs into `qa` with no rebase tax, fires a `qa` preview deploy, then opens a draft `qa -> main` promotion PR. The maintainer QAs the preview and merges the promotion PR; that merge triggers `auto-release.yml` (release + production deploy) and resets `qa` to `main`.
- A PR merged into `qa` does **not** auto-close its `closes #N` issue — GitHub auto-closes only on the default branch. The `qa -> main` promotion PR carries the aggregated `Closes #N` lines.
- A one-off direct change still goes through a PR: either via `qa`, or straight into `main` with the `hotfix` label.

### Stack decisions

These are screening criteria for new vendors, services, and libraries. Any addition that would introduce a new vendor, paid service, auth provider, database, or persistence layer must be surfaced as a `[USER-DECISION]` or `[USER-DECISION + RESEARCH]` open question in the planner's output — never resolved unilaterally by the implementer. **When in doubt, default to blocker.** A false-positive blocker costs one comment round-trip; a false-negative costs a closed PR.

- No beta software for auth or other security-critical paths. A library must be stable/GA before it is a candidate.
- Prefer single vendor — one DPA, one dashboard, one billing relationship is materially simpler than stitching providers together.
- Plan for plausible future scope (per-card analytics, friends/social) when picking persistence shape, not just the current feature needs.

### Backlog / process

For the full process map — GitHub Actions catalog, issue lifecycle state machine, build-gate details, scope-warning thresholds, graceful-exit / WIP salvage, branch protection, the Vercel preview gate, and retrospectives — see [WORKFLOW.md](WORKFLOW.md). This section keeps only the runtime-action rules agents need without leaving AGENTS.md.

The backlog lives on GitHub Issues, labelled `priority:now` / `priority:next` / `priority:later`. The orchestrator usually starts with `gh issue list --label "priority:now"` and picks the top item.

**The user owns priorities.** Don't move issues between priority labels (or columns) without explicit user direction. Items that come up mid-change as out-of-scope captures get filed as new issues with `priority:later` (or `priority:next` if clearly higher) — never auto-promoted to `priority:now`.

When a change closes an issue, reference it in the commit message (`closes #N`) so it auto-closes on push.

**Pre-PR build gate.** After pushing a branch, run `npm run typecheck && npm run build && npm test && npm run test:coverage`. If any step fails, apply a targeted fix and retry — up to two attempts. After the second failure, post a comment with the last 80 lines of build output and stop without opening a PR.

The `test:coverage` step adds roughly 30 seconds (full suite under v8 instrumentation) and catches global-floor breaches before push. The 90% per-diff patch-coverage gate (`scripts/diff-coverage.mjs`) is **not** part of `test:coverage` — it is enforced only in the `coverage` CI workflow against `coverage/coverage-final.json`. To catch per-diff breaches locally too, pipe a diff against your PR base into the script immediately after the `test:coverage` run, while `coverage/coverage-final.json` is still present in the working tree (the script reads that file directly; a subsequent `npm test` run without `--coverage` will overwrite or remove it):

```bash
git diff origin/qa...HEAD | node scripts/diff-coverage.mjs
```

This is optional — the global floor is the most common breach class — but worth running on a PR that adds new product code under `app/`, `components/`, or `lib/`.

**Pre-PR e2e smoke (high-surface-area changes).** If the PR diff touches any of these paths, additionally run the chromium-only Playwright smoke subset locally via the pinned Docker image before opening the PR:

- `app/layout.tsx`
- `app/page.tsx`
- `components/onboarding/**`
- `components/Nav.tsx`, `components/BottomTabBar.tsx`, `components/MobileNavPaddingWrapper.tsx`
- `lib/settings/persistence.ts`
- `playwright.config.ts`

Run from the repo root (the wrapper `scripts/pre-pr-smoke.sh` handles this automatically — it resolves the repo root from its own location, so it works from any subdirectory):

```bash
docker run --rm -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.60.0-noble \
  bash -c "npm ci && npm run build && (npm start &) && npx wait-on --timeout 60000 http://localhost:3000 && npx playwright test --project=chromium e2e/smoke.spec.ts e2e/onboarding.spec.ts e2e/practice-scope.spec.ts e2e/pasture.spec.ts"
```

A convenience wrapper lives at `scripts/pre-pr-smoke.sh` so the long command does not have to be remembered. Same two-attempt retry budget as the other steps: if anything fails, apply a targeted fix and retry up to twice, then stop and report.

The smoke subset is intentionally smaller than CI's full e2e matrix — the goal is to catch the "modal blocks every page" class of regression (PR #1119 was the prompt), not parity. CI still runs chromium + mobile-safari authoritatively on the full spec set. PRs that only touch a single component or page surface outside the trigger list skip this step.

**Pre-push spelling check.** Before pushing, spell-check all prose, code comments, and UI strings against the British-English convention (see "Spelling" above) — `optimise`, `colour`, `behaviour`, etc. Catch this in the first commit, not a follow-up: a second commit just to fix `optimize` → `optimise` is a recurring, trivially avoidable pattern.

**Graceful exit on halt.** If the implement run halts, the post-step commits any uncommitted edits as `WIP: halted run on #N` and pushes to origin, so `/continue` always has a branch to resume from. On resume, check `git log -1 --format=%s` — if the subject starts with `WIP:`, inspect `git diff HEAD~1` and amend or revert before continuing.

**Auto-review on PR open.** `auto-review.yml` fires when a PR opens and posts `<!-- auto-review:1 -->`. Do not run `code-reviewer` yourself in the implement stage — it runs automatically after the PR is open. The workflow resolves the linked issue (`closes/fixes/resolves #N` parsed from PR body, branch name, and commit messages via `.github/scripts/extract-linked-issues.sh`) and passes the issue bodies to the `code-reviewer` sub-agent, which **cross-checks the diff against the issue's acceptance criteria** and raises any uncovered criterion as a Blocker — the reviewer-side counterpart of the implementer cross-check above. This closes the gap surfaced by #1259 / #1260, where partial-scope changes shipped because no later step re-read the issue. When no linked issue can be resolved, the workflow continues and the coverage check is skipped (the diff-quality checks still run).

**CI failure that does not converge — `/investigate-ci-failure`.** If a fix-round fails to converge (the next CI run is still red on the same shape), do not dispatch a second sweep agent. The second sweep will not converge either — sweep agents pattern-match on test names and tweak fixtures or bump timeouts, which is the wrong tool when the real cause is a production-code regression, a perf-budget breach, or a bundle-size cliff. Use the `/investigate-ci-failure` skill (`.claude/skills/investigate-ci-failure.md`) instead: it forces a logic-vs-perf triage, mandates Playwright traces for perf-shape failures, and requires reading the production code path (not just the test) for logic-shape failures before any code change. Memory: `feedback_investigate_after_sweep_fail`; worked examples in `#1234` and `#1263`.

**Planner pre-flight: AC-quality check (#1321).** For non-trivial issues, the `planner` sub-agent reads the issue body and assesses whether the `## Acceptance criteria` section exists and is concrete enough to test against (an implementer or reviewer can produce a yes/no verdict from a build, test run, screenshot, or diff inspection). If the section is missing entirely, or any criterion is vague (subjective wording like "works well", "is intuitive", "looks nice"), the planner returns a **Proposed acceptance criteria** block instead of a full plan. The orchestrator surfaces those proposals to the user via `AskUserQuestion`; on approval it posts the agreed checklist as a comment on the issue, then re-dispatches the planner. Downstream implementer and reviewer cross-checks anchor on the comment-formalised ACs. Trivial issues (typo fixes, doc tweaks, one-liner workflow changes — the same set that may skip the planner entirely) are exempt.

**Planner / `/batch-issues` pre-flight: staleness check (#1322).** Before dispatching an implementer, the planner (and the `/batch-issues` skill during its triage step) runs `.github/scripts/check-issue-staleness.sh <N>` against every non-trivial issue. The script reports `STALE: yes` when the issue is older than the threshold (default 3 days; this project moves fast enough that 3 days is the safe default) **or** when `git log --since=<createdAt>` shows commits touching any backtick-quoted file path in the body. A stale verdict pauses dispatch and surfaces a "confirm ACs still hold" prompt to the user; the user can confirm and proceed, or amend the issue. Per-issue overrides live on the issue itself as a `stale-check:N` label (set the age threshold to N days, e.g. `stale-check:14`) or `stale-check:off` (disable the age branch entirely; the file-activity branch still runs). Run-wide override via the `STALE_THRESHOLD_DAYS` env var. Trivial issues are exempt.

**Planner pre-flight: testability + first-contact UX checklist (#1276).** For any user-facing feature change, the `planner` sub-agent works through two question sets — testability (how a tester reaches each state in under 10 minutes on a fresh environment; whether a seed/flag exists for QA) and first-contact UX (what a first-time or newly-enabling user sees; whether it is self-explanatory). Any gap the planner cannot resolve from the issue and codebase surfaces as a `[USER-DECISION]` open question rather than an unilateral default. Answers fold into the plan as acceptance criteria, a dedicated step, or an `## Out of scope` note. Trivial issues (typo fixes, doc tweaks, one-liner workflow changes — the same set that may skip the planner entirely) are exempt.

**Expect a mini-batch after preview QA.** The `/batch-issues` drain is not finished when the promotion PR opens — the maintainer's QA on the `qa` preview reliably surfaces 1-3 small follow-ups per session (the worked examples: #1270 / #1271 after the #1234 batch; #1331 / #1332 after the multi-locale batch). The skill's playbook bakes in an explicit "mini-batch follow-up" stage between the initial preview QA and the final handoff — file the follow-ups as new issues (`priority:later` by default; `priority:next` if clearly higher), implement the in-scope ones inline, and re-fire the preview deploy after they land. The `feedback_mini_batch_after_qa` memory has the longer rationale.

**End-of-session retro (#1333).** Every `/batch-issues` session ends with a structured retro before the final handoff: what went well, what went poorly with named incidents, concrete improvements written back into the skill / agent defs / AGENTS.md / workflows, and memories to file or update. The retro then ratchets the coverage floor (see "Coverage gate" above) and the documented values in this file before the run closes. The retro step is run regardless of session size — a clean run produces a short retro, a noisy one produces the corrective edits the next session needs. See the `/batch-issues` skill "End-of-session retro" and "Coverage ratchet" steps for the runbook.

### Privacy

Two paths exist -- guest and authenticated. The constraints differ.

**Guest path**
- All card/session data stays in the browser. Review state lives in localStorage; it is never transmitted to a server we control.
- Sprites are self-hosted as static files under `public/sprites/pokemon/` and served from the same Vercel deployment as the app. No sprite requests leave our infrastructure.
- **Aggregate telemetry**: Vercel Analytics and Speed Insights collect anonymous, aggregate page-view metrics (URL path, referrer, country, device type) and Core Web Vitals. This data goes to Vercel's infrastructure — it does not include card progress, review history, or any personally identifying information. Both components are rendered unconditionally in the root layout.

**Authenticated path (Supabase sync)**
- When a user signs in with GitHub, their per-card review history (FSRS state: stability, difficulty, scheduledDays, reps, lapses, fsrsState, due date, last review, first seen) is stored in Supabase Postgres.
- We **are a data controller** for authenticated users. GDPR / UK-GDPR obligations apply: we need a privacy notice, a lawful basis for processing (legitimate interest / contract performance), and a data-processing agreement with Supabase (covered by Supabase standard DPA).
- A user-facing privacy notice is required before this feature is made generally available. Filing it as a follow-up issue is the right next step -- it is out of scope for the initial sync implementation.
- Supabase is the sub-processor for authenticated user data. Row-Level Security ensures each user can only read/write their own rows. (Vercel Analytics is a second sub-processor for aggregate telemetry across all users — see the guest-path note above.)
- Sign-out does **not** clear localStorage -- local data is preserved so users can sign out and continue as guests without losing progress.
