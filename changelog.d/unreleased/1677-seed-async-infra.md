---
kind: changed
issue: 1677
---
- Add async seed-loading infrastructure: `seed-constants.ts` (extracted ID-namespace constants), `buildSeed` pure function in `seed.ts`, `seed-async.ts` module-singleton loader that fetches `generated-core.json` + `generated-chains.json` from `public/pokemon-data/` at runtime, and `SeedContext.tsx` React context. Existing synchronous `SEED_POKEMON` / `SEED_EVOLUTION_CARDS` / `SEED_REVERSE_EVOLUTION_CARDS` exports are unchanged. Stage 1 of #1677.
