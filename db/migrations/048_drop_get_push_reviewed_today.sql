-- Migration: 048_drop_get_push_reviewed_today (#2116)
--
-- Drops public.get_push_reviewed_today(uuid[], date), created by migration 047.
-- Since #2073 (PR #2113) app/api/push/send-streak-nudge/route.ts derives
-- "reviewed today" from the user's local-day streak_days rows
-- (get_push_streak_days) and no longer calls this RPC, which matched the UTC
-- card_reviews.last_review and was wrong off UTC. Nothing else references it.
--
-- get_push_streak_days(uuid[]) is untouched.
--
-- Apply to BOTH the prod and QA Supabase projects before merge (name without
-- the 048_ prefix: drop_get_push_reviewed_today).

DROP FUNCTION IF EXISTS public.get_push_reviewed_today(uuid[], date);
