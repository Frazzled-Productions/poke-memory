# Local development gotchas

Moved out of `AGENTS.md` (2026-10-14).

- `localhost:3000` and `pokememory.com` are different origins → independent `localStorage`. When local dev and deployed behaviour differ, suspect localStorage drift first - clear the `poke-memory:*` keys and reload, or QA against the latest preview URL.
- **Build needs the pinned Node major** (`.nvmrc`; `.npmrc` `engine-strict` + a `prebuild` guard fail-fast, #1493). Node 26 breaks the esbuild-wasm/Turbopack build - `nvm use` or a Homebrew `node@24` on `PATH`, and brief sub-agents the same (they inherit the machine default).
- **"Unlimited reviews" on a fresh session isn't a bug**: `buildSessionQueues` (`lib/review/session.ts`) only counts a review toward `reviewsDoneToday` when `lastReview === today && firstSeen !== today`, so the 100/day soft wall can't fire until prior-day cards come due; totals are bounded by the new-card caps × learning-step replays.
- **Evolution cards inherit the pre-evo's types for scope matching (#426)**: `cardMatchesScope` (`lib/review/scope.ts`) resolves `card.preEvoId` to its `SeedPokemon.types` - a Fire scope includes `Charmander → Charmeleon` but excludes `Eevee → Flareon`. Forward and reverse evo cards anchor all three axes on the pre-evo.

## Cloudflare Worker locally (decision 0018)

- **Node 24** (`PATH=/opt/homebrew/opt/node@24/bin:$PATH`). `npm run dev` still works: `next.config.ts` gives `next dev` the D1 and R2 bindings from `wrangler.jsonc` through a local Miniflare.
- **Local D1**: `npm run db:migrate:local` applies `db/d1/migrations/` to `.wrangler/state` (gitignored). Unit tests need none of this: they use the node:sqlite shim in `lib/db/testing/sqliteD1.ts`.
- **Smoke the real Worker**: `npm run cf:build`, then `npx wrangler dev`, and open `/`, `/pokedex`, `/settings`. Add `--test-scheduled` and request `/__scheduled?cron=0+*+*+*+*` to fire a Cron Trigger; `--var CRON_SHARED_SECRET:<local value>` for the cron bearer. Local secrets otherwise go in a gitignored `.dev.vars` (names in `wrangler.jsonc`).
- **`spawn EBADF` from `wrangler dev`**: `public/sprites/` and `public/audio/` (about 14,000 files) are copied into `.open-next/assets/`, and wrangler's asset watcher runs out of file descriptors. Move both out of `public/` **before** `npm run cf:build`, run `wrangler dev`, then move them back:

  ```sh
  mkdir -p .wrangler/public-aside && mv public/sprites public/audio .wrangler/public-aside/
  npm run cf:build && npx wrangler dev
  mv .wrangler/public-aside/sprites .wrangler/public-aside/audio public/ && rmdir .wrangler/public-aside
  git status --short public   # must print nothing
  ```

  Sprites and cries then 404 in that local Worker; everything else renders. Never commit while they are moved.
