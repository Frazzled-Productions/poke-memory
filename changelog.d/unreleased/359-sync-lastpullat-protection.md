---
kind: fixed
---
- Sync no longer rewinds today's reviews on PWA cold reopen. `useManualSync` now persists `lastPullAt` after a successful pull, and the background-pull merge keeps any card with local progress when `lastPullAt` is null instead of unconditionally taking the cloud row.
