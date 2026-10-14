# Local development gotchas

Moved out of `AGENTS.md` (2026-10-14).

- `localhost:3000` and `pokememory.com` are different origins → independent `localStorage`. When local dev and deployed behaviour differ, suspect localStorage drift first - clear the `poke-memory:*` keys and reload, or QA against the latest preview URL.
- **Build needs the pinned Node major** (`.nvmrc`; `.npmrc` `engine-strict` + a `prebuild` guard fail-fast, #1493). Node 26 breaks the esbuild-wasm/Turbopack build - `nvm use` or a Homebrew `node@24` on `PATH`, and brief sub-agents the same (they inherit the machine default).
- **"Unlimited reviews" on a fresh session isn't a bug**: `buildSessionQueues` (`lib/review/session.ts`) only counts a review toward `reviewsDoneToday` when `lastReview === today && firstSeen !== today`, so the 100/day soft wall can't fire until prior-day cards come due; totals are bounded by the new-card caps × learning-step replays.
- **Evolution cards inherit the pre-evo's types for scope matching (#426)**: `cardMatchesScope` (`lib/review/scope.ts`) resolves `card.preEvoId` to its `SeedPokemon.types` - a Fire scope includes `Charmander → Charmeleon` but excludes `Eevee → Flareon`. Forward and reverse evo cards anchor all three axes on the pre-evo.
