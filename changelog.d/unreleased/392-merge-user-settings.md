---
kind: changed
---
- The FSRS optimizer now persists weights atomically via a new `merge_user_settings` SQL function instead of read-merge-write. No user-visible behaviour change (#392).
