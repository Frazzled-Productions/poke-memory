# poke-memory

Anki-style spaced-repetition flashcards for learning the names of all 1025 Pokémon.

You see a sprite, mentally answer, hit **Reveal**, and grade yourself with one of four buttons — Again / Hard / Good / Easy. The SM-2 scheduler decides when to show the card again: easy ones drift further out, struggling ones come back tomorrow.

## Live demo

**[poke-memory-alpha.vercel.app](https://poke-memory-alpha.vercel.app)**

Hosted on Vercel; auto-deploys on every push to `main`. Your progress lives in the browser's `localStorage`, so it's per-device and starts fresh on a different machine.

### Install on iPhone

Open the live demo in Safari, tap **Share → Add to Home Screen**. Tapping the icon opens the app in standalone mode — no Safari chrome — with a Pokédex-themed icon. It looks and feels like a native app, but everything still runs in the browser.

## What's in it

- All 1025 canonical Pokémon (gen 1 through gen 9, no alternate forms).
- **Daily streak counter** — review at least one card to keep your streak alive; missing today is forgiven if you reviewed yesterday. Visible as a badge on the Practice page and a card on the Stats page.
- **Four pages**: **Practice** (the daily review loop), **Stats** (mastery distribution, due forecast, per-generation progress, struggling-card list, current streak), **Pokédex** — a 1025-cell grid that fills in as you learn; tap any cell to open a detail page with type badges, stat bars, flavour text, evolution chain, and a full facts panel, and **Settings** — configure mastery threshold, new-card cap, and review cap.
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

Hobby project, work-in-progress. See [CHANGELOG.md](./CHANGELOG.md) for what's been built so far.
