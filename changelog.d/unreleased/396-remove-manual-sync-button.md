---
kind: changed
---
- Removed the manual Sync button from Stats. Background sync paths (per-grade push, unload safety-net, visibility-pull) now handle all cases. When the unload beacon fails, the Stats sync status line becomes a one-click Retry that re-pushes only the failed cards — no pull, no full-sweep.
