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
- **Four pages**: **Practice** (the daily review loop), **Stats** (mastery distribution, due forecast, per-generation progress, struggling-card list), **Pokédex** — a 1025-cell grid that fills in as you learn, and **Settings** — configure mastery threshold, new-card cap, and review cap.
- SM-2 scheduling — well-known algorithm, fully spec'd math, no ML constants to tune.
- Daily limits: 10 new cards and 100 reviews per day by default, adjustable in Settings. Keeps the load sustainable.
- Stable per-day shuffle — order rotates daily so the same Pokémon doesn't always lead, but stays stable while you're working through a session.
- All state lives in your browser's `localStorage`. Nothing is sent anywhere.

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
