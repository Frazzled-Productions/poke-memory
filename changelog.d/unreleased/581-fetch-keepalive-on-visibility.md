---
kind: fixed
---
- Sync: partial-failure unload pushes are no longer silently reported as success. The `visibilitychange` handler now uses `fetch` with `keepalive: true` so the server's response code is observable, and the route retries each batch up to three times before declaring failure. `pagehide` still uses `sendBeacon` (page is tearing down — response code unobservable by definition) and remains best-effort.
