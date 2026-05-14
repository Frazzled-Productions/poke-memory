---
kind: fixed
---
- Persistence validator now accepts reverse-evolution cards. Previously every saved session containing a rev-evo card failed schema validation on load, causing the practice page to silently rebuild fresh state on every reload — local progress would re-appear as "new" cards even though the cloud was correctly storing it.
- Defensive fallback in `saveSession`: a silent IndexedDB write failure no longer reports success and loses the write — falls back to localStorage instead.
