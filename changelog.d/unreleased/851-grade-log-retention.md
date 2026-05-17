---
kind: changed
---
- Review history is now kept indefinitely in IndexedDB (no longer hard-trimmed to the last 365 days). Signed-in users already had full history in the cloud; this brings the local store in line. The localStorage fallback applies a quota-aware safety valve instead of a fixed date cut-off.
