# poke-memory

An Anki-style spaced-repetition app for learning Pokémon names and evolutions, with progress tracking of what the user knows. A Pokédex browser is a secondary surface.

This repo also serves as a sandbox for practicing Claude Code sub-agent workflows — see the roster and playbook below. When choosing how to do work here, lean toward demonstrating sub-agent patterns over the fastest path, but only when the agent earns its keep.

## Stack
- Next.js 16.2.5 (App Router)
- React 19.2.4
- Tailwind CSS 4
- TypeScript 5

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Sub-agent roster

Custom agents live in `.claude/agents/`. Invoke via the Agent tool with `subagent_type: "<name>"`.

| Agent | When to use |
|---|---|
| [next16-expert](.claude/agents/next16-expert.md) | Any Next.js 16 API / caching / routing / rendering question. Read-only. |
| [pokeapi-expert](.claude/agents/pokeapi-expert.md) | Choosing PokéAPI endpoints, schemas, caching. Use BEFORE writing integration code. |
| [srs-expert](.claude/agents/srs-expert.md) | Designing/implementing the spaced-repetition scheduler. |
| [supabase-expert](.claude/agents/supabase-expert.md) | Supabase Auth, Postgres + RLS, schema design for SM-2 state, Next.js 16 App Router client patterns. Use BEFORE writing any Supabase integration code. Read-only. |
| [workflow-expert](.claude/agents/workflow-expert.md) | Any non-trivial change to `.github/workflows/**` or `.claude/agents/**`. Read-only. |
| [planner](.claude/agents/planner.md) | Designing an implementation plan before any code is written. |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist. |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling. |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations. |
| [playwright](.claude/agents/playwright.md) | E2E smoke tests after a user-facing change. Owns `e2e/**`. |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change. Read-only. |

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly — they receive research findings via the prompt. The standard flow for non-trivial work:

1. **Plan** — invoke `planner`. It surfaces unknowns to research first.
2. **Research in parallel** — invoke specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Pass findings to coders via prompt.
3. **Implement** — invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run them in parallel when their work is independent.
4. **E2E** — if the change is user-facing, invoke `playwright` to add or update E2E smoke tests. Pass the diff summary and affected pages.
5. **Review** — invoke `code-reviewer` at the end. Iterate on its punch list.

When *not* to use a sub-agent: small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value. Seeing when to skip an agent is part of the practice.

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

### Sync (authenticated users)

Two-layer model for pushing review state to Supabase:

1. **Per-grade debounced upsert (primary path)** — `usePerGradeSync(client, userId)` returns `{ enqueueGrade, flushPending }`. Call `enqueueGrade(card)` fire-and-forget immediately after each grade. A 200 ms debounce coalesces rapid re-grades; when it fires, one upsert per pending card is sent via `pushSingleCard`. Failed cards stay in the queue for the next grade cycle or the unload safety-net.

2. **Unload safety-net (secondary path)** — `useSyncOnUnload(client, userId, flushPending)` registers `visibilitychange` / `pagehide` listeners. On unload it calls `flushPending()` (from `usePerGradeSync`) to get the still-unsynced cards; if non-empty, it dispatches them via `navigator.sendBeacon('/api/sync', blob)`. When the per-grade path is working normally, `flushPending()` returns `[]` and the unload push is skipped entirely.

- **Unload-time send mechanism:** `useSyncOnUnload` uses `navigator.sendBeacon('/api/sync', blob)` rather than calling the Supabase JS client directly. `sendBeacon` is the W3C-specified mechanism for guaranteed delivery during page hide and carries same-origin cookies automatically — ITP does not affect same-origin requests, so mobile Safari auth cookies are included. The receiver is `app/api/sync/route.ts` — a POST Route Handler that authenticates via session cookie and upserts server-side. `lastPushFailed` in sync status reflects whether the browser accepted the beacon (the synchronous return value of `sendBeacon`), not whether the server upserted. `pushSession` is not replaced — it remains the manual-sync / force-resync path (runs while the page is visible, no keepalive needed).
- **`pushSession` is not deleted** — it remains the batched fallback and the escape hatch for "force resync" scenarios.
- **Volume**: 100 reviews/day → at most 100 single-row upserts (often fewer after debounce coalescing). Well within Supabase free-tier limits.
- Guest-mode guard runs on every `enqueueGrade` call, not just at mount, so mid-session sign-out is safe.

### Sync: background pull on visibility

When a signed-in tab regains focus after being hidden ≥ 30 seconds, `useVisibilityPull` (mounted via `SyncOnVisible` in the root layout) silently calls `pullAndMerge`, which pulls all cloud rows and merges them into `localStorage`.

**Blocked routes**: `["/"]` — the practice session is excluded to avoid interrupting an active review. The block is route-level; the session-complete screen (still at `/`) is also excluded, which is the accepted tradeoff for keeping the implementation simple.

**`lastPullAt` and clock-skew mitigation**: `SyncStatus.lastPullAt` stores the ISO timestamp from the most-recently-updated cloud row in the pull response (server-side `updated_at`), not `Date.now()`. This prevents a device with a drifting local clock from producing false "cloud is newer" signals on subsequent pulls.

**Per-card conflict rule** (implemented in `mergeCloudIntoLocalSilent` in `lib/sync/cloud.ts`):
1. `lastPullAt` is `null` (first pull on this device) → cloud wins unconditionally.
2. `card.state.lastReview !== null && lastReview >= lastPullAt.slice(0, 10)` → this device graded since the last pull (same calendar day or later) → **keep local**.
3. `cloudRow.updated_at > lastPullAt` → cloud has newer state → **take cloud**.
4. Otherwise (cloud row unchanged since last pull) → **keep local**.

The `>=` date comparison is conservative: any review on the same calendar day as the pull counts as "graded since pull," preventing incorrect reverts when sub-day ordering cannot be determined from `YYYY-MM-DD` strings.

**Synthetic `StorageEvent` invariant**: `pullAndMerge` dispatches a synthetic `StorageEvent` for `"poke-memory:review-session:v1"` after writing to `localStorage`. Any other code that writes this key must also dispatch this event so same-tab subscribers (`useSessionStorageKey` in Stats and Pokédex pages) are notified. Cross-tab listeners receive the native event automatically.

**Reactive re-render**: `useSessionStorageKey` (`lib/review/useSessionStorageKey.ts`) returns an incrementing counter on each matching storage event. Stats and Pokédex pages include this counter in their session-loading `useEffect` dependency arrays so they re-render after a background pull without a page reload.

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

- **Algorithm**: SM-2.
- **Grading UX**: 4 buttons mapping to SM-2 grades — `Again` (1) / `Hard` (2) / `Good` (4) / `Easy` (5). Anki-equivalent collapse.
- **Per-card review state**:
  ```ts
  type ReviewState = {
    repetitions: number;       // consecutive successful reviews
    interval: number;          // days until next review
    easeFactor: number;        // multiplier, min 1.3, default 2.5
    dueDate: string;           // ISO 8601 date "YYYY-MM-DD"
    lastReview: string | null; // null sentinel = never reviewed
    firstSeen: string | null;  // ISO date of first-ever grade; set once, never overwritten
  };
  ```
- Dates as `"YYYY-MM-DD"` strings (string-comparable, no timezone math). The `nextReview` scheduler is a pure function and lives in `lib/srs/`.
- **Queue policy**: two queues — review (`lastReview !== null && dueDate <= today && lastReview !== today`) served first, then new (`lastReview === null`). Within each queue, deterministic per-day shuffle via FNV-1a hash of `id + today` (stable for the day, rotates daily).
- **Daily limits**: 10 new cards/day (hard wall — exceeding inflates tomorrow's review queue), 100 reviews/day (soft wall with "Keep reviewing" override). Counters: `newIntroducedToday = firstSeen === today`; `reviewsDoneToday = lastReview === today && firstSeen !== today`.
- **Persisted session shape**: `{ cards: ReviewCard[], limits: DailyLimits }` in `localStorage`. `loadSession` silently migrates the legacy bare-`ReviewCard[]` shape and backfills `firstSeen` from `lastReview` on existing cards.

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

### Documentation

- **README.md** is the user-facing entry point — audience is a curious visitor or contributor. Concise, scannable, includes run-locally instructions.
- **CHANGELOG.md** tracks notable user-facing changes. Loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Add a fragment file under `changelog.d/unreleased/` whenever a commit changes user-facing behavior or adds a feature — **do not edit `CHANGELOG.md` directly** (see `changelog.d/README.md` for the format).
- **WORKFLOW.md** is the process map — sub-agent roster, orchestration playbook, GitHub Actions catalog, issue lifecycle, build gates, and retrospectives. Update it in the same commit that changes a workflow or orchestration behavior.
- **All three files are updated as part of the same commit that lands the change** — no separate docs-only commit. Orchestrator handles the edit inline; no specialist agent.
- Internal conventions (this file, `AGENTS.md`) are kept separate from user-facing docs. Don't merge them.

### Versioning

- **Standard**: SemVer 2.0.0.
- **Pre-v1 semantics**: `0.MINOR.PATCH` for all pre-v1 releases. Bump rules (applied per-release to the set of merged fragments):
  - `kind: minor-bump` fragment present → minor bump (`0.N.0 → 0.N+1.0`)
  - any other non-empty set of fragments → patch bump (`0.N.P → 0.N.P+1`)
  - major (`1.0.0`) remains a manual decision
  - Patch is the default; minor is opt-in via a dedicated `kind: minor-bump` fragment. This preserves PR 230's intent under the fragment-based workflow introduced in PR 234.
- **Cadence: release on merge to `main`.** `auto-release.yml` runs on every push to `main`. If `changelog.d/unreleased/` contains any `*.md` fragments, the workflow assembles them into the next `## [X.Y.Z]` section, bumps the SemVer, commits (deleting the consumed fragments), tags, pushes, and creates a GitHub Release. If no fragments exist, the workflow no-ops. Since Vercel auto-deploys on every push to `main`, "tagged release" and "deployed to production" are the same event in this project.
- **Version source**: `package.json` is the single source of truth. The release workflow bumps it automatically — never edit the version field by hand.
- **Fragment promotion**: when a release is cut, `cut-release.mjs` assembles the fragments into a new `## [X.Y.Z] — YYYY-MM-DD` block inserted after the static `## [Unreleased]` stub in `CHANGELOG.md`, and the release commit deletes all `changelog.d/unreleased/*.md` files. The `## [Unreleased]` heading and its HTML comment remain in `CHANGELOG.md` as a permanent stub.
- **Loop break**: the workflow's own commit is `chore(release): vX.Y.Z [skip ci]`. The `[skip ci]` marker suppresses all workflows on that commit, and the `chore(release):` prefix is a defensive `if:` guard on the job. Combined, this prevents the release run from re-triggering itself.
- **Fragment content guidance for contributors**: only add fragments you are happy to ship in the very next release — every merge to `main` cuts one. Internal-only changes that should not bump the version (e.g. agent-roster tweaks) should not have a fragment at all. The fragment format is:
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

> For the full process map (GitHub Actions catalog, issue lifecycle state machine, build-gate details, graceful-exit / WIP salvage, and retrospectives), see [WORKFLOW.md](WORKFLOW.md). This section records the implementer-action rules agents need at runtime.

The backlog lives on GitHub Issues, labelled `priority:now` / `priority:next` / `priority:later`. The [Poké Memory roadmap](https://github.com/orgs/Frazzled-Productions/projects/1) is a kanban view over the same data.

When starting a new change, the orchestrator runs `gh issue list --label "priority:now"` (or checks the project board) to find candidates. Usually grabs the top `priority:now` item; otherwise asks the user to pick.

**The user owns priorities.** Don't move issues between priority labels (or columns) without explicit user direction. Items that come up mid-change as out-of-scope captures get filed as new issues with `priority:later` (or `priority:next` if clearly higher) — never auto-promoted to `priority:now`.

When a change closes an issue, reference it in the commit message (`closes #N`) so it auto-closes on push.

**Retrospectives.** When an issue closes via a merged PR, `auto-retro.yml` posts a `<!-- auto-retro -->` comment. The retro is *process reflection* — it does not recommend code changes. Retro comments are one of four input channels consumed weekly by `auto-workflow-suggest.yml` — that workflow is where cross-retro aggregation happens, producing a single digest issue per ISO week. Promoting digest patterns to convention (adding them to this file) remains the human's responsibility.

**Branch protection on `main`.** A repository ruleset (`main-protection`, ID `16176438`) enforces: required status check `test` (the job from `ci.yml`), no force pushes, linear history. Manage via `gh api /repos/fraserbrookhouse/poke-memory/rulesets/16176438`; toggle `enforcement` between `active` / `evaluate` / `disabled` to stage changes.

**Pre-PR build gate.** After pushing a branch, run `npm run typecheck && npm run build && npm test`. If any step fails, apply a targeted fix and retry — up to two attempts. After the second failure, post a comment with the last 80 lines of build output and stop without opening a PR.

**CI check.** `ci.yml` runs the same triple on every `pull_request` event and push to `main`. The required-check name is `test` (the job ID, not the workflow name `CI`).

**Graceful exit on halt.** If the implement run halts, the post-step commits any uncommitted edits as `WIP: halted run on #N` and pushes to origin, so `/continue` always has a branch to resume from. On resume, check `git log -1 --format=%s` — if the subject starts with `WIP:`, inspect `git diff HEAD~1` and amend or revert before continuing.

**Scope warning + `/split`.** When the planner detects large scope (≥4 files, ≥3 surfaces, infra + logic with ≥3 files, or ≥6 acceptance criteria), it runs a coupling check before offering `/split`. Coupling exists when proposed children share a symbol name, `localStorage` key, DB table, leaf module directory, or file — coupled children produce PRs that don't compose at merge time. If coupling is found, `/split` is not offered; proceed as a single issue. When children are cleanly independent, the planner appends a **Suggested split** block and `/split` is available. Each child inherits the `auto` label and triggers its own plan run.

**Auto-review on PR open.** `auto-review.yml` fires when a PR opens and posts `<!-- auto-review:1 -->`. Do not run `code-reviewer` yourself in the implement stage — it runs automatically after the PR is open. Fork PRs are explicitly excluded (`head.repo.fork == false` in the job-level `if:`) — this is a deliberate guard, not a side-effect of GitHub's default secret-isolation policy.

### Privacy

Two paths exist -- guest and authenticated. The constraints differ.

**Guest path (unchanged)**
- No personal data leaves the user browser. All session state lives in localStorage; nothing is transmitted to a server we control. No analytics, no error tracking, no telemetry.
- Sprites are self-hosted as static files under `public/sprites/pokemon/` and served from the same Vercel deployment as the app. No sprite requests leave our infrastructure.

**Authenticated path (Supabase sync)**
- When a user signs in with GitHub, their per-card review history (SM-2 state: repetitions, interval, ease factor, due date, last review, first seen) is stored in Supabase Postgres.
- We **are a data controller** for authenticated users. GDPR / UK-GDPR obligations apply: we need a privacy notice, a lawful basis for processing (legitimate interest / contract performance), and a data-processing agreement with Supabase (covered by Supabase standard DPA).
- A user-facing privacy notice is required before this feature is made generally available. Filing it as a follow-up issue is the right next step -- it is out of scope for the initial sync implementation.
- Supabase is the sole sub-processor for authenticated user data. Row-Level Security ensures each user can only read/write their own rows.
- Sign-out does **not** clear localStorage -- local data is preserved so users can sign out and continue as guests without losing progress.