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
| [planner](.claude/agents/planner.md) | Designing an implementation plan before any code is written. |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist. |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling. |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations. |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change. Read-only. |

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly — they receive research findings via the prompt. The standard flow for non-trivial work:

1. **Plan** — invoke `planner`. It surfaces unknowns to research first.
2. **Research in parallel** — invoke specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Pass findings to coders via prompt.
3. **Implement** — invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run them in parallel when their work is independent.
4. **Review** — invoke `code-reviewer` at the end. Iterate on its punch list.

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
| `README.md`, `CHANGELOG.md` | orchestrator — updated inline as part of each commit, no specialist agent |

## Conventions

These are decisions made through deliberate research/discussion, not guesses. Add to this section only when a real decision is locked in.

### Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- For read-your-own-writes after a Server Action mutation (e.g. user grades a card → must immediately see updated state), use `updateTag(tag)`. Server Actions only.
- For background SWR-style invalidation from Route Handlers, use `revalidateTag(tag, 'max')`. The single-argument form is deprecated and produces a TS error.
- Use `revalidatePath('/path')` only when invalidating path-level data, not specific tags.
- Tag the underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions — without that, there is nothing for `updateTag` to invalidate.

### Page params

- `params` and `searchParams` are `Promise` — always `await` them. Synchronous access from earlier Next.js versions is fully removed.
- Prefer the generated `PageProps<'/path/[seg]'>` helper for page components after `next typegen` / first `next dev` / first `next build` has run. The manual inline `params: Promise<{ slug: string }>` always works without that step.

### PokéAPI integration

- **Seed at build time, not request time.** Run a one-off seed script that fetches `/pokemon-species` (master list) → `/pokemon/{id}` (sprites) → `/pokemon-species/{id}` (display name + chain URL) → `/evolution-chain/{id}` (deduped) and writes a local store. The Pokédex list page never hits PokéAPI at runtime.
- **Canonical Pokémon set comes from `/pokemon-species`** (~1025 species), not `/pokemon` (~1300+ which includes Megas, regional variants, Gigantamax forms with IDs 10001+). For each species, resolve to `varieties[0]` for the primary pokemon record.
- **Display name** lives on `pokemon-species.names[]` filtered to `language.name === "en"`. The `name` field on `/pokemon` is a kebab-case slug, not a display name.
- **Default sprite**: `sprites.other["official-artwork"].front_default`. Fall back to `sprites.front_default` when null. Self-host before production (PokéAPI sprites live on `raw.githubusercontent.com`).
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

### Documentation

- **README.md** is the user-facing entry point — audience is a curious visitor or contributor. Concise, scannable, includes run-locally instructions.
- **CHANGELOG.md** tracks notable user-facing changes. Loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Add an entry under `## [Unreleased]` whenever a commit changes user-facing behavior or adds a feature.
- **Both files are updated as part of the same commit that lands the change** — no separate docs-only commit. Orchestrator handles the edit inline; no specialist agent.
- Internal conventions (this file, `AGENTS.md`) are kept separate from user-facing docs. Don't merge them.

### Backlog / process

The backlog lives on GitHub:

- **Issues**: every idea, bug, or queued change is a GitHub issue, labelled with `priority:now` / `priority:next` / `priority:later`. Issues are user-owned; anyone the user grants access can file new ones. Phone-accessible via the GitHub mobile app.
- **Project board** ([Poké Memory roadmap](https://github.com/orgs/Frazzled-Productions/projects/1)): kanban view with a `Priority` field (Now / Next / Later) corresponding to the labels. Same source data as Issues, visualised. The project lives under the `Frazzled-Productions` org so a GitHub App can mutate it (Apps cannot write user-owned Projects v2).
- **Status field** drives the kanban columns and is moved automatically by the auto-issue / auto-pr workflows: `Todo` → `Planned` (planner posted) → `In Progress` (`/go` triggered) → `PR` (PR open, awaiting review or `Needs fixes`) → `Ready to merge` (latest auto-review verdict is `Looks good to me`) → `Done` (issue closed). The `auto-status.yml` workflow handles the close-to-Done transition; the other transitions live alongside the matching workflow phases.

When starting a new change, the orchestrator runs `gh issue list --label "priority:now"` (or checks the project board) to find candidates. Usually grabs the top `priority:now` item; otherwise asks the user to pick.

**The user owns priorities.** Don't move issues between priority labels (or columns) without explicit user direction. Items that come up mid-change as out-of-scope captures get filed as new issues with `priority:later` (or `priority:next` if clearly higher) — never auto-promoted to `priority:now`.

**The user can file ideas any time** — phone, web, anywhere they have GitHub access — without waiting for a chat response. That's the point of moving off a chat-only workflow.

When a change closes an issue, reference it in the commit message (`closes #N`) so it auto-closes on push.

**Retrospectives.** When an issue closes via a merged PR, `auto-retro.yml` posts a single `<!-- auto-retro -->` comment on the closed issue answering: which sub-agents earned their keep, which were overhead, and one transferable lesson. Skipped for `not_planned` closures and issues with no linked merged PR. The retro is *process reflection* — it does not recommend code changes. Aggregating retros into convention is left manual for now; if a pattern recurs across several retros, promote it into this file by hand.

**Pre-PR build gate.** `auto-issue.yml`'s implement job runs `npm ci` and instructs the orchestrator to run `npm run typecheck && npm run build` after pushing the branch but before opening the PR. If the build fails, the orchestrator is allowed up to two targeted fix attempts (commit + push + retry). After the second failure, it posts a comment with the last 80 lines of build output and stops without opening a PR — the branch stays pushed for manual inspection. The goal: catch type/build errors in the same run that produced them, instead of finding out via Vercel after the PR is open.

**Vercel auto-fix.** When a Vercel deployment fails on an `auto/issue-*` branch, `vercel-failure-autofix.yml` fetches the error excerpt from Vercel's events API and posts it as a `/fix` comment on the PR, which triggers `auto-pr.yml`'s usual fix cycle (subject to its 3-cycle cap). Requires the `VERCEL_TOKEN` repo secret (Vercel personal access token, read access to deployments); without it the workflow is a no-op. Idempotent within a 10-minute window per PR — Vercel sometimes fires multiple `failure` events for one deployment.

### Privacy

- **No personal data leaves the user's browser without explicit consent.** All session state lives in `localStorage`; nothing is transmitted to a server we control. No analytics, no error tracking, no telemetry.
- This is a hard project constraint. While the app stays fully client-side and processes no personal data, GDPR / UK-GDPR obligations are minimal — we are not a data controller for any user data.
- When we add a backend, accounts, analytics, or any third-party service that processes personal data, this section gets updated and we do a one-off review pass to identify obligations (privacy notice, consent UI, data-processing agreements). Until then, no per-commit legal review is needed.
- Sprite URLs are fetched directly by the user's browser from `raw.githubusercontent.com` (PokéAPI's CDN). We don't proxy them, so no information about which Pokémon a user is learning passes through any infrastructure we control.
