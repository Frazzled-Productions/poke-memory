---
kind: changed
---
- Updated `docs/sync.md`, `docs/persistence.md`, and `AGENTS.md` to cover migrations 015-019: the cumulative trigger guards on `card_reviews` (reps/lapses, scheduled_days, seen_in_pasture), the `reset_all_progress` SECURITY DEFINER RPC, the dropped UPDATE/DELETE policies on `grade_log`/`streak_days`, and the new `timezone` + `date_format` scalar columns on `user_settings`. Also clarified the AGENTS.md date-handling note (FSRS scheduling stays UTC; user-facing day boundaries are timezone-aware).
