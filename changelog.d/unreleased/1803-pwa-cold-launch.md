---
kind: fixed
issue: 1803
---
- PWA cold-launch hang eliminated: the service worker now serves the app shell stale-while-revalidate instead of blocking on the network for up to 10 s (NetworkFirst was the root cause of the ~5 s hang on the installed iOS PWA).
- Pokémon seed data (generated-core.json, generated-chains.json, generated-locale-names.json, generated-flavor.json) is now precached at build time so cards render immediately on cold launch without a separate network round-trip.
