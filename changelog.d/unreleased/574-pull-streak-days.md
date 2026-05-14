---
kind: fixed
---
- Sync: background pull (`pullAndMerge`) now pulls `streak_days` from cloud and union-merges with local. Streak data was previously push-only, so a second device with stale local always saw the wrong current-streak number until that device itself reviewed.
