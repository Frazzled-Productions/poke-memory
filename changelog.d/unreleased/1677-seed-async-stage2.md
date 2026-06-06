---
kind: fixed
issue: 1677
---
- Stage 2 of async seed loading (#1677 / #1604): `ReviewSession` now reads the seed from `useSeed()` (SeedContext) instead of a direct module-level import of `@/lib/pokemon/seed`. `SEED_POKEMON` and `SEED_EVOLUTION_CARDS` are no longer value-imported by the practice page at module level, so the seed JSON is not required to parse synchronously before the ReviewSession component can render. A branded loading skeleton and a retry-on-error state replace the previous synchronous block.
- `<SeedProvider>` wired into `app/layout.tsx`, making the async seed available to all routes via `useSeed()`.
- The `EvolutionCard` type alias conflict (component vs data type) in `ReviewSession.tsx` resolved by aliasing the data type as `SeedEvolutionCard`.
- Missing `</SeedProvider>` closing tag in `app/layout.tsx` fixed.
- `ReviewSession.test.tsx` updated: `vi.mock("@/lib/pokemon/SeedContext")` added, providing a stable `useSeed()` mock that returns seed data via the existing `mockSeedPokemon` fixture. All 103 existing tests continue to pass.
- Boot-path consumer migration complete: `lib/review/scope.ts`, `lib/superuser/SuperuserContext.tsx`, and `lib/profile/useProfileStatus.ts` no longer value-import from `@/lib/pokemon/seed` at module level. `scope.ts` uses `getSeedIfLoaded()` with correct lazy-only memoisation (never caches an empty result); `SuperuserContext.tsx` calls `await loadSeed()` inside the async exit-cleanup effect; `useProfileStatus.ts` reads `seed?.seedPokemon.length` from `useSeed()` and re-runs when the seed loads.
- `vitest.setup.node.ts` and `vitest.setup.ts` updated to call `_primeSeed()` with the full seed, so `getSeedIfLoaded()` returns real data in all test environments without triggering a fetch.
- `GameScopePicker.test.tsx` updated to mock `@/lib/pokemon/SeedContext` (the component was migrated to `useSeed()` in Stage 2) so its 10 unit tests continue to pass.
- Bundle verification: after the build, the 1.28 MB seed chunk (`0fw0.e~tljz7m.js`) is NOT referenced in `index.html` (the `/` route's first-load HTML). The seed JSON has left the boot path. `Ivysaur`, `captureRate`, and other seed-unique identifiers are absent from all 20 first-load chunks (~1.25 MB total, dominated by the React/Next.js/Supabase framework chunks).
