---
kind: fixed
issue: 1643
---
- Pasture: resolve Pokémon names via `useLocalePokemonName` for the sprite button `aria-label`, `<Image alt>`, popover `aria-label`, and popover visible name. Screen-reader users in Japanese, Simplified Chinese, and Traditional Chinese now hear the locale-appropriate name rather than the English name. Popover visible name is wrapped in `<span lang>` for non-English locales.
