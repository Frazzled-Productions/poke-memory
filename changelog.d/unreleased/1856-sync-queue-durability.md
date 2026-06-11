---
kind: fixed
issue: 1856
---
- Offline grades from a force-killed tab are no longer silently discarded: the persisted queue is rehydrated on the next session and pushed to the cloud.
- A card rejected by the regression trigger (SQLSTATE 23514) is now evicted from the retry queue instead of being retried forever and poisoning the unload beacon batch.
- `updated_at` on `card_reviews` is now stamped server-side by a `BEFORE UPDATE` trigger (migration 043) so the `lastPullAt` clock-skew anchor is always authoritative regardless of the pushing device's clock.
- `pullAndMerge` and the `useSyncOnUnload` catch path re-read the current sync status immediately before writing, preventing concurrent legs from clobbering each other's fields.
- Re-grading the same card while a push is in flight no longer causes the newer re-grade to be silently dropped from the queue.
- `clearLocalProgress` no longer sweeps other users' archived state on a shared device.
