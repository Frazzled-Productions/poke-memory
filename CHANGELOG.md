# Changelog

All notable user-facing changes to poke-memory. Format loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project hasn't tagged a release yet, so everything currently lives under `[Unreleased]`.

## [Unreleased]

### Deployment

- **Live at [poke-memory-alpha.vercel.app](https://poke-memory-alpha.vercel.app)** — hosted on Vercel, auto-deploys on every push to `main`.

### Added

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

[Unreleased]: https://github.com/fraserbrookhouse/poke-memory
