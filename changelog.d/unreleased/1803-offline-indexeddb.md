---
kind: fixed
---

- Offline sprite/cry pack now stored in IndexedDB instead of Cache Storage, eliminating the root cause of the iOS PWA cold-launch hang (#1803). A Cache Storage with ~10,000+ entries makes WebKit's `cache.match` globally slow, stalling render-critical precache lookups on every cold launch. Moving the offline pack to IndexedDB keeps Cache Storage small so cold launch is fast regardless of whether the pack is downloaded.
- On SW activate, the old `poke-memory-sprites-v2` / `poke-memory-cries-v2` Cache Storage buckets are deleted automatically, unblocking existing affected users without any manual action.
- The "Delete offline cache" button now clears the IndexedDB offline-pack store and also sweeps the legacy Cache Storage buckets for users who have not yet received the new SW activate.
