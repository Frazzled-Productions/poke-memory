---
kind: security
---
- Lock down `grade_log` and `streak_days` to append-only at the DB layer (drop UPDATE/DELETE RLS policies). The "Reset all progress" Settings button now routes through a single `reset_all_progress` SECURITY DEFINER RPC that wipes the user's own rows in `card_reviews`, `grade_log`, and `streak_days` atomically. Previous behaviour only deleted `card_reviews` rows.
