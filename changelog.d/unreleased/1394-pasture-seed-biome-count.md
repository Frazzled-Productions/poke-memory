---
kind: fixed
---
- Pasture page now honours the active Pokémon name locale when computing mastered species. Switching to Japanese or Chinese in Settings correctly shows only cards mastered in that locale, instead of always showing the English count.
- Mastered Pokémon now appear in their correct biomes (Grasslands, Forest, Cave, and so on) instead of all falling into Wildlands. Previously, QA-seeded and freshly-loaded cards were missing habitat data, so every species defaulted to the "unknown" bucket and biome stats showed zero mastered.
