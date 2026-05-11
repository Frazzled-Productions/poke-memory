# poke-memory

[![Release](https://img.shields.io/github/v/release/fraserbrookhouse/poke-memory)](https://github.com/fraserbrookhouse/poke-memory/releases)

Anki-style spaced-repetition flashcards for learning the names of all 1025 Pokémon.

Two card directions, each scheduled independently by SM-2:

- **Forward** (default on) — sprite shown as prompt, name revealed on flip.
- **Reverse** (default off, enable in Settings) — name shown as prompt, sprite revealed on flip.

Hit **Reveal**, grade yourself Again / Hard / Good / Easy, and the scheduler decides when each card comes back — easy cards drift out, struggling ones return sooner.

## Live demo

**[poke-memory-alpha.vercel.app](https://poke-memory-alpha.vercel.app)**

Hosted on Vercel; auto-deploys on every push to `main`. Your progress lives in the browser's `localStorage`, so it's per-device and starts fresh on a different machine.

### Install on iPhone

Open the live demo in Safari, tap **Share → Add to Home Screen**. Tapping the icon opens the app in standalone mode — no Safari chrome — with a Pokédex-themed icon. It looks and feels like a native app, but everything still runs in the browser.

## What's in it

- All 1025 canonical Pokémon (gen 1 through gen 9, no alternate forms). Two card directions per species: **forward** (sprite → name) and **reverse** (name → sprite), each scheduled independently. Reverse cards are off by default; enable them in Settings.
- **Daily streak counter** — review at least one card to keep your streak alive; missing today is forgiven if you reviewed yesterday. Visible as a badge on the Practice page and a card on the Stats page.
- **Four pages**: **Practice** (the daily review loop with a live Again/Hard/Good/Easy tally for the current session), **Stats** (all-time grade breakdown, mastery distribution, due forecast, per-generation progress, struggling-card list, current streak), **Pokédex** — a 1025-cell grid with progressive disclosure: unlearned Pokémon appear as silhouettes, reviewed Pokémon greyscale, and mastered ones in full colour. Tap any cell to open a detail page that reveals the same tiers — types and flavour text unlock when you start learning, base stats, facts, and the evolution chain unlock once mastered. And **Settings** — configure mastery threshold, new-card cap, and review cap.
- **Pokémon facts on card flip** — when you reveal a card, a randomly-selected fact appears below the name (height, weight, type, genus, generation, catch difficulty, gender ratio, habitat, growth rate, and more). A new random fact is picked each flip.
- SM-2 scheduling — well-known algorithm, fully spec'd math, no ML constants to tune.
- Daily limits: 10 new cards and 100 reviews per day by default, adjustable in Settings. Keeps the load sustainable.
- Stable per-day shuffle — order rotates daily so the same Pokémon doesn't always lead, but stays stable while you're working through a session.
- All state lives in your browser's `localStorage` by default. Sign in with GitHub to sync your progress across devices.


## Sync your progress

Sign in with GitHub (the **Sign in** button in the nav) to sync your review history across devices. Once signed in, your progress is pushed to the cloud at the end of each session.

- **Guest mode** -- no account needed; everything stays in your browser.
- **Sign in** -- ties your session to a GitHub account via Supabase Auth; data stored in Postgres.
- **Conflict picker** -- if you have local progress *and* cloud progress when you sign in, you will be asked which to keep.
- **Auto-pull on focus** -- returning to a tab that's been in the background for ≥ 30 seconds silently pulls the latest cloud state and updates Stats and Pokédex without a page reload.
- Signing out leaves your local localStorage intact; you can continue as a guest without losing anything.

> **Note:** Supabase project URL and anon key must be configured (see `.env.local.example`). GitHub OAuth redirect URIs must be added in the Supabase dashboard.

## Run locally

```bash
npm install
npm run seed   # one-time fetch of all 1025 species from PokéAPI (~1–2 min)
npm run dev    # http://localhost:3000
```

The seed step writes `lib/pokemon/generated.json`, which is committed to the repo, so the seed is only required if that file is missing or you want to regenerate it (e.g. after a new Pokémon generation ships).

## Stack

Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, TypeScript 5.

## Development

This repo doubles as a sandbox for practicing Claude Code sub-agent workflows. The custom agent roster, orchestration playbook, and project conventions live in [AGENTS.md](./AGENTS.md). Agent definitions are in [`.claude/agents/`](./.claude/agents/).

## Status

Hobby project, work-in-progress. See [CHANGELOG.md](./CHANGELOG.md) for what's been built so far and [Releases](https://github.com/fraserbrookhouse/poke-memory/releases) for tagged versions.
