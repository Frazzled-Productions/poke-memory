---
kind: fixed
issue: 1852
---
- Journey evolution wall now shows Pokémon names in your chosen Pokémon-name language (Japanese, Simplified Chinese, Traditional Chinese) instead of always showing English names. Image alt text and edge aria-labels are updated to match.
- Stats "Struggling cards" list now resolves locale names via the locale-aware hook; the speciesId field was missing from StrugglingCard, preventing the hook from being called at all.
- Higher-or-Lower minigame tiles now display localised Pokémon names instead of raw English seed names.
- Pokédex and Pasture search now matches the locale name and transliteration (rōmaji for Japanese, pinyin for Chinese) as well as the English name, so searching by the name visible on screen works for all supported locales.
- Pokédex alphabetical sort now uses the displayed locale name with an appropriate collator instead of sorting by invisible English strings.
