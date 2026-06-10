---
kind: fixed
issue: 1803
---
- Fixed the remaining PWA cold-launch hang by switching the service-worker navigation strategy from `NetworkFirst` (10 s timeout) to `StaleWhileRevalidate`. The SW now serves the cached app shell instantly on cold launch rather than blocking paint until the network returns the HTML document.
- Precached the Pokémon seed data (`public/pokemon-data/*.json`) so cards render immediately on cold launch without a separate network round-trip.
