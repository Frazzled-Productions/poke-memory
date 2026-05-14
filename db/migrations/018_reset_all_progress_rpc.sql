-- Migration: 018_reset_all_progress_rpc
--
-- Two changes:
--
-- 1. Drop client-facing UPDATE/DELETE policies on append-only tables.
--    grade_log and streak_days are immutable audit/history tables — rows should
--    only ever be inserted or read. Removing UPDATE/DELETE at the RLS layer
--    prevents a future client bug from silently wiping history.
--
-- 2. Add a single SECURITY DEFINER RPC for the destructive "Reset all progress"
--    path.  Centralising the wipe in one function that explicitly checks
--    auth.uid() is the canonical Supabase pattern for "user can wipe their own
--    data, no one else's".  The function deletes from all three tables
--    atomically, so the previous behaviour (card_reviews only) is now complete.

-- Drop client-facing UPDATE/DELETE policies on append-only tables.
DROP POLICY IF EXISTS "grade_log_update" ON grade_log;
DROP POLICY IF EXISTS "grade_log_delete" ON grade_log;
DROP POLICY IF EXISTS "streak_days_update" ON streak_days;
DROP POLICY IF EXISTS "streak_days_delete" ON streak_days;

-- The single destructive path. SECURITY DEFINER + explicit auth.uid()
-- check is the canonical Supabase pattern for "user can wipe their own
-- data, no one else's".
CREATE FUNCTION reset_all_progress()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'reset_all_progress requires an authenticated session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.card_reviews WHERE user_id = uid;
  DELETE FROM public.grade_log WHERE user_id = uid;
  DELETE FROM public.streak_days WHERE user_id = uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_all_progress() FROM public, anon;
GRANT EXECUTE ON FUNCTION reset_all_progress() TO authenticated;
