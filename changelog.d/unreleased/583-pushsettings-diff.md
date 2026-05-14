---
kind: fixed
---
- Sync: settings pushes now send only the keys that changed since the last successful push from this device, rather than the whole JSONB blob. Two devices changing disjoint settings (themeIntensity on A, maxNewPerDay on B) no longer race to clobber each other.
