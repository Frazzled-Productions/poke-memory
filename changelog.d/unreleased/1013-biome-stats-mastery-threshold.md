---
kind: fixed
---
- Pasture biome stats no longer undercount mastered Pokémon when the mastery repetitions threshold is set below 3. The redundant `isMastered()` re-check inside `biomeStats()` (which always used the hardcoded default of 3) has been removed; the function now trusts the pre-filtered input from its callers, which already honour the user's configured threshold.
