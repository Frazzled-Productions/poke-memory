---
kind: fixed
---
- Manual Sync now pulls cloud rows before pushing local state. A stale or emptied local session can no longer overwrite real cloud progress through the upsert path.
