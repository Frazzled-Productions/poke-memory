# Backlog

A running list of ideas and queued work for poke-memory.

**How to use this file:** Add ideas freely as they come — bullet points are fine, full proposals welcome. Three sections by rough priority. Move items between them as priorities shift. The orchestrator (Claude in your session) reads from here when starting a new slice — usually grabs the top `Now` item or asks you to pick. Mark items done by deleting them, or with `[done]` if you want a record.

## Now

Next-slice candidates. Pick the top one (or any) when ready to start work.

- **Learning steps / relearning queue** — fixes the "first-day session feels short" UX. Anki-style learning steps where a new card sees 1m / 10m intervals within the same session before being scheduled out to tomorrow, and lapsed cards re-enter learning steps. Needs an `srs-expert` design pass before implementing — meaningful change to the scheduler.

## Next

Queued, but not the immediate priority.

- **Settings page** — surfaces the things currently hardcoded: mastery threshold (`MASTERY_REPETITIONS`), daily limits (`maxNewPerDay`, `maxReviewsPerDay`). Persisted alongside `cards` already; just needs UI.
- **Second card type — "what does X evolve into?"** — uses the evolution-chain data that's currently out of scope for the seed script. Would need to extend the seed + UI for showing chain prompts.
- **Pokédex detail view** — clicking a cell on `/pokedex` opens a small modal or page with that Pokémon's stats, types, flavor text, and evolution chain.

## Later

Parking lot. Not committed; revisit whenever.

- **Per-session grade breakdown** (Again / Hard / Good / Easy counts) — needs an event log of individual grade events; current state can't reconstruct.
- **Streak tracking** ("7-day streak") — needs an event log or daily-review-dates array.
- **Android-friendly manifest** — add 192×192 icon + a `purpose: "any maskable"` icon entry so Chrome's PWA install prompt accepts it. Currently iOS-first.
- **`?source=pwa` analytics marker** on `start_url` in the manifest — only worth doing if/when analytics ever land. Privacy convention currently rules them out.
- **Multi-device sync** — would need a backend, accounts, and a real privacy review (we'd become a data controller). Substantial scope.
- **Self-host sprites** — currently linked from `raw.githubusercontent.com`. Fine for hobby, flagged in AGENTS.md as "before production".
