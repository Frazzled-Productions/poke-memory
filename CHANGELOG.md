# Changelog

All notable user-facing changes to poke-memory. Format loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project hasn't tagged a release yet, so everything currently lives under `[Unreleased]`.

## [Unreleased]

### Added

- **Component test infrastructure and pre-PR test gate** — `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, and `jsdom` are now installed. Vitest is configured with two projects: `node` (existing scheduler and session tests, no DOM overhead) and `jsdom` (component tests). A `ReviewSession` reveal-flow test covers the unrevealed → revealed → graded lifecycle and would catch regressions like the one from #47. The pre-PR build gate in `auto-issue.yml` now runs `npm test` as a third step after `typecheck` and `build`. Closes [#48](https://github.com/fraserbrookhouse/poke-memory/issues/48).

- **Auto-label workflow** — newly-opened GitHub issues now receive `priority`, `type`, and `area` labels automatically via Claude classification (`auto-label.yml`), so issues filed from mobile land on the project board without manual triage.

- **Multi-device sync** -- optional GitHub sign-in syncs your review history across devices via Supabase. Guest mode is fully intact -- signing in is opt-in and signing out leaves local progress untouched. If you sign in on a device that already has progress alongside existing cloud data, a conflict picker lets you choose which side to keep. Session state is pushed to Supabase at the end of each session (visibilitychange / pagehide). Closes #9.

- **Evolution card type** — a second question format is now mixed into the review session: "What does X evolve into?" Using the same SM-2 spaced-repetition algorithm but with **per-type daily budgets** — name cards keep their existing 10 new / 100 review caps, evolution cards get a separate 5 new / 50 review default. Both are individually configurable on the Settings page (now grouped under "Name cards" and "Evolution cards" sections). Evolution cards interleave with name cards within each session; the per-type counters mean burning your evolution budget never blocks new name cards (and vice versa). Branching evolutions (Eevee → 8 forms) show all valid answers on reveal. Single-stage Pokémon (legendaries, Ditto, Lapras, etc.) produce no evolution card. Existing sessions migrate automatically — the ~457 new cards are appended with fresh SM-2 state on first load after the update; existing custom limit settings are preserved as the new name-card limits, with evolution defaults filled in. Closes #3.

### Deployment

- **Live at [poke-memory-alpha.vercel.app](https://poke-memory-alpha.vercel.app)** — hosted on Vercel, auto-deploys on every push to `main`.

### Fixed

- **Sign in / Sign out now work correctly** — clicking Sign in or Sign out was a no-op due to Server Actions being invoked outside `startTransition`. Both buttons now wrap their action in `startTransition`, which lets the Next.js client router process the redirect response. Buttons are disabled and show "Signing in…" / "Signing out…" while the action is in flight. Closes [#89](https://github.com/fraserbrookhouse/poke-memory/issues/89).

- **Learning-step countdown now survives page navigation** — the “Next card in X seconds” timer previously reset to the full step duration (1m or 10m) every time you left and returned to the practice page. It now persists a `stepStartedAt` timestamp on each card, so on remount the countdown correctly resumes from where it left off. Closes [#20](https://github.com/fraserbrookhouse/poke-memory/issues/20).

### Added

- **Daily streak counter** — the home page now shows a "N days streak" badge above the practice session, and the stats page has a Current streak card. A streak counts consecutive days you reviewed at least one card; missing today doesn't break the streak as long as you reviewed yesterday (grace window). Reviewed dates are persisted to `localStorage` independently from session state. Closes [#41](https://github.com/fraserbrookhouse/poke-memory/issues/41) and [#42](https://github.com/fraserbrookhouse/poke-memory/issues/42).

- **Pokémon facts on card flip** — when you hit Reveal on a review card, a randomly-selected fact about that Pokémon appears below the name alongside the grading buttons. Facts cover height, weight, type, genus (e.g. "Seed Pokémon"), generation, catch difficulty, base happiness, growth rate, habitat, gender ratio, base experience, strongest stat, and Pokédex flavour text entries. A new random fact is picked on every flip, so repeated "Again" cards show fresh information. The same facts are accessible on the Pokédex detail page in a new Facts panel. Closes [#11](https://github.com/fraserbrookhouse/poke-memory/issues/11).

- **Pokédex detail page** (`/pokedex/[id]`) — clicking any cell on the Pokédex grid now navigates to a dedicated detail page for that Pokémon. Shows the official-artwork sprite, National Déx number, type badge(s) with colour coding, a six-stat bar chart (HP / Attack / Defense / Sp. Atk / Sp. Def / Speed), a flavour-text blurb, and the full evolution chain as clickable sprite thumbnails. All 1025 species are covered, including Eevee’s 8-branch chain. Types, stats, flavour text, and evolution data are baked into `lib/pokemon/generated.json` at build time — no runtime API calls. Closes [#4](https://github.com/fraserbrookhouse/poke-memory/issues/4).

- **Settings page** (`/settings`) — configure mastery threshold (default 3), new cards per day (default 10, hard cap 1–50), and reviews per day (default 100, soft cap 1–500). Changes take effect on the next session. Stats page now reads the mastery threshold from settings rather than a hardcoded constant. Closes [#2](https://github.com/fraserbrookhouse/poke-memory/issues/2).

- **Anki-style learning steps** — new cards now cycle through `1m / 10m` learning steps within the same session before graduating to a 1-day interval; lapsed cards re-enter a single `10m` relearning step before resuming review scheduling. Same 4-button grading UX (Again / Hard / Good / Easy). When only future-due learning cards remain, the session shows a live countdown until the next card is ready. Closes [#1](https://github.com/fraserbrookhouse/poke-memory/issues/1).
- **Android PWA installability** — the web app manifest now includes a 192×192 icon with separate `"any"` and `"maskable"` purpose entries, satisfying Chrome for Android's PWA install criteria. The icon uses the same Pokédex-lens design as the iOS touch icon, scaled to 192×192. Closes [#7](https://github.com/fraserbrookhouse/poke-memory/issues/7).
- **PWA / iPhone home-screen support** — Add to Home Screen on iOS Safari now opens the app in standalone mode (no Safari chrome) with a Pokédex-themed icon. Adds `app/manifest.ts` (`display: "standalone"`), a 180×180 apple-touch-icon and a 32×32 favicon (both programmatically generated via `ImageResponse`), and the iOS-specific `appleWebApp` metadata + `viewport` theme-colour configuration.
- **Stats page** (`/stats`) — five derived stats from existing card state: mastery distribution (locked / learning / mastered as a stacked bar), total introduced with progress bar, due-today/tomorrow forecast, per-generation breakdown across gens I–IX, and a struggling-cards list (bottom 10 by ease factor). No charting library — hand-rolled bars.
- **Pokédex-fill page** (`/pokedex`) — 1025-cell grid grouped by generation. Locked cells silhouette the sprite and hide the name (preserving the surprise of unlearned Pokémon); learning and mastered cells reveal them with distinct visual treatments.
- **Top navigation** — links to Practice, Stats, and Pokédex on every page; active route highlighted.
- **Daily limits** — 10 new cards and 100 reviews per day by default. New is a hard wall (exceeding it inflates tomorrow's queue); reviews are a soft wall with a "Keep reviewing?" override.
- **Two-queue card ordering** — review cards served before new cards, with a deterministic per-day shuffle within each queue (FNV-1a hash of `id + today`). Stable for the day, rotates daily.
- **Three end-state screens** — _All caught up_, _Daily review limit reached_ (with override), _New cards locked for today_ (hard wall).
- **Daily progress pill** showing _Today: X new · Y reviews_.
- **`firstSeen` field** on each card, set exactly once on the first-ever grade — closes a hole where lapsing your way through new cards bypassed the daily limit.
- **Hydrate-on-load** — when new seed entries are added (e.g. after a re-seed), they're appended to the saved session at default state without losing existing progress.
- **Full 1025-species seed** from PokéAPI via `npm run seed`. Writes `lib/pokemon/generated.json` (committed for zero-setup checkout).
- **First end-to-end review loop** — open app → see sprite → reveal name → grade → next card. SM-2 scheduling, `localStorage` persistence, accessibility-aware UI (semantic buttons, focus rings, screen-reader announcements).

### Changed

- **Persisted session shape** grew from `ReviewCard[]` to `{ cards, limits }` to support per-user limits. Existing saved sessions are silently migrated on load.
- **`Cache Components` enabled** in `next.config.ts` — the project commits to the modern Next.js 16 caching model end-to-end.

### Project conventions (internal)

- **8 custom Claude Code sub-agents** covering planning, research, coding, and review. Roster and orchestration playbook in [AGENTS.md](./AGENTS.md).
- **Conventions captured in AGENTS.md** as decisions are locked in: caching, page params, PokéAPI integration, spaced repetition, documentation, privacy.
- **`auto-retro.yml` workflow** — when an issue closes via a merged PR, posts a single retrospective comment on the closed issue focused on which sub-agents earned their keep on that change. One transferable lesson per change, so the sandbox practice compounds.

- **`/continue` resume** — commenting `/continue` on an issue with a halted auto-run picks up the paused orchestrator on the existing branch, rather than starting a fresh one with `/go`.
- **Planner scope warning + `/split`** — when a plan touches too many files or surfaces, the planner appends a scope warning and a suggested split. Commenting `/split` creates the proposed child issues as native GitHub sub-issues of the parent, inheriting its priority label.
- **Standalone `auto-review.yml`** — code-review now runs as its own workflow on `pull_request` open instead of as a final step inside `auto-issue.yml`'s implement job. Bot-opened PRs still get exactly one review on creation; manually-opened PRs (e.g. when an App-permissions block forces a manual push) can opt in by adding an `auto-review` label, restoring the `/fix` loop. Closes [#33](https://github.com/fraserbrookhouse/poke-memory/issues/33).

[Unreleased]: https://github.com/fraserbrookhouse/poke-memory
