---
kind: fixed
issue: 1846
---
- Offline pack download now checks available storage headroom (via `navigator.storage.estimate()`) before starting, comparing it against the pack's expected size plus a buffer for concurrent progress saves. When space is tight a low-storage warning appears with "Cancel" and "Download anyway" options, instead of silently filling the origin quota and disrupting card-progress saves. If the Storage API is unavailable the download proceeds as before.
