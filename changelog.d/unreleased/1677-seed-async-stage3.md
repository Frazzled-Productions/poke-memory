---
kind: changed
---
- Remove the ~1.28 MB Pokémon seed JSON from the first-load client bundles of all non-Practice routes (Pokédex, Stats, Settings, Pasture, Journey, Auth callback). The seed now loads asynchronously via `SeedContext`; pages gate their effects on `seed !== null` and render normally once data arrives. The QA-seed scenario builders and backup import/export read the loaded seed instead of value-importing it, and a `check:bundle` CI guard fails the build if the seed ever leaks back into a static chunk.
