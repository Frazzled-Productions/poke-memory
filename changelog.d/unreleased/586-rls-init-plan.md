---
kind: changed
---
- Rewrite all 12 RLS policies on `card_reviews`, `streak_days`, `user_settings`, and `grade_log` to use `(SELECT auth.uid())` instead of `auth.uid()` directly. PostgREST now evaluates the auth function once per query rather than once per row, clearing Supabase advisor lint 0003 and improving plan quality on the larger tables.
