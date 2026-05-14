---
kind: security
---
- Sync: schema-level guard against the delete-resurrection class. `user_settings.last_reset_at` is stamped atomically by `reset_all_progress`, and BEFORE INSERT triggers on `card_reviews`, `streak_days`, and `grade_log` reject any row dated before that timestamp. A stale device pushing data from before a reset can no longer silently resurrect rows in cloud — the relevant insert will fail with a check_violation that the client surfaces as a sync failure rather than treating as success.
