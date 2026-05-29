---
kind: added
---
- Added `scripts/lint-i18n.mjs` message-catalogue completeness gate (`npm run lint:i18n`), wired into `npm run lint` and CI, to catch missing or extra keys across the `ja`, `zh-Hans`, and `zh-Hant` catalogues before they reach production.
