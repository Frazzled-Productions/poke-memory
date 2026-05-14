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
| `README.md`, `CHANGELOG.md` | orchestrator — updated inline as part of each commit, no specialist agent |
| `e2e/**` | playwright |
| `.github/workflows/**` | workflow-expert (review); orchestrator (edits) |
| `.claude/agents/**` | workflow-expert (review); orchestrator (edits) |

## Conventions

These are decisions made through deliberate research/discussion, not guesses. Add to this section only when a real decision is locked in.

### Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- For read-your-own-writes after a Server Action mutation (e.g. user grades a card → must immediately see updated state), use `updateTag(tag)`. Server Actions only.
- For background SWR-style invalidation from Route Handlers, use `revalidateTag(tag, 'max')`. The single-argument form is deprecated and produces a TS error.
- Use `revalidatePath('/path')` only when invalidating path-level data, not specific tags.
- Tag the underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions — without that, there is nothing for `updateTag` to invalidate.

### Superuser mode (READ when adding user-facing features)

Superuser mode is a QA cheat unlocked by typing `super` (desktop) or 7-tapping the nav title (mobile). It does **not** itself change behaviour — it reveals a **Developer** section on the Settings page that houses per-behaviour flags.

**Flags are per axis of cheating, not per page.** Today there is one flag (`pretendAllMastered`) that renders every species as mastered. Future axes (e.g. "skip daily limits", "force-reveal cards") get their own flag. Do **not** add a per-page toggle that re-derives mastery — wire the page into `flags.pretendAllMastered` instead.

**Every new user-facing feature must honour the relevant superuser flag.** Specifically: if a feature displays mastery state, completion counts, per-Pokémon collection state, or anything gated on having mastered things, it must read `useSuperuser().flags.pretendAllMastered` (or a future appropriate flag) and treat it as "fully mastered" when on. The canonical pattern is `forceAllMastered || isMastered(...)`; pure functions take an optional `forceAllMastered` parameter (see `computeStats`, `computeRecords`, `filterMastered`).

If a feature genuinely should not be affected (e.g. the all-caught-up Higher-or-Lower minigame samples from real seen-pool, not mastered state), call that out explicitly in the PR description and the planner step's acceptance criterion.

**Sync write-guard.** While any superuser flag is on, all cloud writes are suppressed:
- `usePerGradeSync.enqueueGrade` and `useSyncOnUnload` short-circuit because `ReviewSession.tsx` passes `null` client/userId.
- `AutoSyncOnChange` short-circuits the same way.
- `SyncNowButton` renders disabled with a "Sync paused (superuser)" label.
- Background pulls (`SyncOnVisible`, `SignInPull`) stay enabled — reads can't corrupt the cloud.

Do not work around this guard. The whole point is that a QA session with cheats on can never leak fake state into Supabase, regardless of which flag is active.

**Exit cleanup.** When the last flag is toggled off (or the chord/tap re-locks superuser while flags were on), `SuperuserContext` runs `exitCleanup`:
- Signed-in: force-pulls cloud and overlays local via `mergeCloudIntoLocal`, then dispatches a synthetic `StorageEvent` so same-tab listeners re-read. This wipes any QA drift in local state.
- Guest: `window.confirm` offers a destructive local-state reset since there is no cloud to fall back to.

Both branches assume the user understands they're exiting a QA mode. Do not silently skip the prompt or the pull.

### Sync (READ FIRST when touching `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`)

The canonical reference is **[docs/sync.md](docs/sync.md)** — read it before touching anything that pushes to Supabase. Headline rules:

- **Pull before push.** Manual sync pulls and merges before pushing; if `pullSession` fails, do not push. Pushing on stale local state is the exact failure mode that wiped 2497 of 2513 cloud rows (#293).
- **`card_reviews_reject_regression_trigger` (migration 002, extended in 015/016/017)** blocks regressions on `card_reviews` at the DB layer — lifecycle timestamps, monotonic `reps`/`lapses` counters, same-date `scheduled_days` drops, and the one-way `seen_in_pasture` flag. Do not work around it. The only destructive path that bypasses the per-column guards is `reset_all_progress` (migration 018, SECURITY DEFINER RPC).
- **Cards drive success/error state.** Streak and settings sync legs are best-effort — they `console.warn` and continue rather than flip the overall sync into the error state.
- **No PITR yet** (#298). Treat any production sync change as one-way until PITR is enabled.

[docs/sync.md](docs/sync.md) covers the four sync paths (per-grade debounced upsert, unload beacon, background pull on visibility, manual sync), the per-card conflict rule, the regression trigger, per-table conflict policy, schema notes for `user_settings` / `card_reviews` / `grade_log`, and catastrophic-recovery posture.

### Adding a feature that needs to persist data

The full decision tree — JSONB field on `user_settings` vs. column on `card_reviews` vs. new table, plus the new-table checklist (uuid PK, FK to `auth.users` with `ON DELETE CASCADE`, SELECT + INSERT RLS policies as the append-only baseline with opt-in UPDATE/DELETE, indexes, regression-trigger pattern) — lives in **[docs/persistence.md](docs/persistence.md)**. Tables today are `card_reviews`, `streak_days`, `user_settings`, `grade_log`.

For card-shaped persistence — anything keyed by `(user_id, card_type, subject_key)` — the decision record (why one table with a discriminator over per-card-type tables, when to add a new `card_type` vs. a sidecar table, subject-key encoding conventions) lives in **[docs/card-identity.md](docs/card-identity.md)**. Read it before adding a new card type or extending the `card_reviews` schema.

Two things to remember at runtime without leaving AGENTS.md:

- **Apply the migration BEFORE merging the PR.** `migration-check.yml` fails the required CI check until file-vs-applied parity holds. Call `mcp__supabase__apply_migration(name, query)` after opening the PR.
- **Wire cross-device sync** by adding `lib/sync/<feature>.ts` and hooking it into `useManualSync` after the existing legs. Auxiliary legs are best-effort — `console.warn` and continue, never flip the overall sync into the error state.

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

#### E2E tests (Playwright)

Playwright smoke tests live in `e2e/` and run against Vercel preview deployments via `e2e.yml`. Config is in `playwright.config.ts`.

- **Scope**: guest-mode flows only (no auth). Tests verify page loads, navigation, interactive flows (card flip, grade buttons), and key content on each page.
- **Projects**: `chromium` and `mobile-safari` (Webkit with iPhone 14 viewport) — both run in CI.
- **Base URL**: set via `PLAYWRIGHT_BASE_URL` env var (preview URL in CI, `http://localhost:3000` locally).
- **Run locally**: `npm run test:e2e` (requires `npx playwright install` first).
- **Selectors**: prefer `getByRole`, `getByText`, and `getByLabel` over CSS selectors or test IDs. Match the accessible names already in the markup (ARIA labels, headings, button text).
- **When to add E2E tests**: any change that adds a new page, a new interactive flow, or modifies an existing user-facing flow should include or update an E2E test in `e2e/`. The bar is smoke-level coverage — verify the happy path loads and key interactions work, not exhaustive edge cases.
- **File naming**: one spec file per feature area (e.g. `e2e/smoke.spec.ts` for cross-cutting smoke tests, `e2e/pokedex.spec.ts` for Pokédex-specific flows).

### Local development gotchas

`localhost:3000` and `pokememory.com` are different origins → independent `localStorage`. State (practice scope, review session, settings, superuser flags) does not flow between them. When a behaviour differs between local `next dev` and the deployed app, suspect localStorage drift before suspecting framework code — clear the `poke-memory:*` keys on the dev origin and reload, or QA against the latest preview URL from `vercel-preview-on-ready.yml`.

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
  Update the topic file in the same commit that changes its subsystem; the pointer in AGENTS.md stays short.
- **All of these are updated inline in the commit that lands the change** — no separate docs-only commit, no specialist agent.

### Screenshots

The README shows five screenshots (`docs/screenshots/{practice-front,practice-flipped,pokedex-grid,pasture,stats}.png`), all captured at the **iPhone 17 Pro viewport** (402×874 CSS px @ 3× DPR) so the README grid lines up uniformly. The capture script is `scripts/capture-screenshots.mjs`, wrapped as `npm run screenshots`.

**Rule.** When a change visibly affects any of those five surfaces — `app/page.tsx` (Practice), `app/pokedex/**`, `app/pasture/**`, `app/stats/**`, or a `components/**` change that the surface renders — regenerate the affected screenshot(s) and commit them in the same PR. **Run locally on macOS only.** CI does not regenerate, because Linux font anti-aliasing differs visibly from macOS Core Text and would clobber every screenshot on every PR.

```bash
npm run dev &                          # in another terminal, or in the background
npm run screenshots                    # all five
npm run screenshots -- --page=pasture  # one surface
```

The script uses the `pretendAllMastered` superuser flag so renders are deterministic without depending on a particular review history. Don't change the viewport, the device-scale factor, or the surface list without updating every existing screenshot in the same commit — the README layout assumes consistent shape.

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
- **Prerequisite**: the `poke-memory-bot` App must be configured as a bypass actor on the `main-protection` ruleset (ID 16176438) so its release commit can land on `main` without going through a PR. If `auto-release.yml` ever fails with a protected-branch error on `git push origin main`, that is the missing setup.

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

**Pre-PR build gate.** After pushing a branch, run `npm run typecheck && npm run build && npm test`. If any step fails, apply a targeted fix and retry — up to two attempts. After the second failure, post a comment with the last 80 lines of build output and stop without opening a PR.

**Graceful exit on halt.** If the implement run halts, the post-step commits any uncommitted edits as `WIP: halted run on #N` and pushes to origin, so `/continue` always has a branch to resume from. On resume, check `git log -1 --format=%s` — if the subject starts with `WIP:`, inspect `git diff HEAD~1` and amend or revert before continuing.

**Auto-review on PR open.** `auto-review.yml` fires when a PR opens and posts `<!-- auto-review:1 -->`. Do not run `code-reviewer` yourself in the implement stage — it runs automatically after the PR is open.

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
