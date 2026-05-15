-- Migration: 026_reset_all_progress_cooldown
--
-- Adds a rate-limit check to public.reset_all_progress() (issue #616).
--
-- WHY
-- The RPC is correctly scoped to auth.uid(), so it cannot wipe another user's
-- data. The remaining risk is session-token replay: an attacker who captures a
-- live session can call the RPC in a tight loop to defeat any forthcoming
-- undo/grace-period feature or to flood the audit log. A 5-second cooldown
-- also kills accidental double-fires from a buggy UI (e.g. a double-click or a
-- network-retry loop that fires the reset twice before the first completes).
--
-- IMPLEMENTATION
-- The check reads user_settings.last_reset_at, which migration 022 added and
-- update atomically inside reset_all_progress(). If that timestamp is non-NULL
-- and less than 5 seconds ago, the function raises an exception before touching
-- any data.
--
-- SQLSTATE CHOICE
-- PL/pgSQL's RAISE ... USING ERRCODE accepts a 5-char SQLSTATE code or a
-- limited set of named condition aliases. 'too_many_requests' is NOT a
-- recognised PL/pgSQL condition name. We use SQLSTATE 'P0001' (raise_exception)
-- which is the standard user-defined exception code. Callers can distinguish it
-- by inspecting the message text ("reset_all_progress: cooldown active").
-- The Supabase/PostgREST client surfaces this as a PostgrestError with
-- code = 'P0001' and message containing the RAISE message.

CREATE OR REPLACE FUNCTION reset_all_progress()
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

  -- Rate-limit: reject calls that arrive within 5 seconds of the previous
  -- successful reset. This closes the session-token replay window and kills
  -- accidental double-fires from a buggy UI.
  IF EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = uid
      AND last_reset_at > now() - interval '5 seconds'
  ) THEN
    RAISE EXCEPTION 'reset_all_progress: cooldown active, retry shortly'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.card_reviews WHERE user_id = uid;
  DELETE FROM public.grade_log WHERE user_id = uid;
  DELETE FROM public.streak_days WHERE user_id = uid;
  -- Stamp the tombstone marker. If the user has never written settings,
  -- this insert creates the row; the JSONB column defaults to {} which
  -- pullSettings treats as "no real cloud settings" — so the row's
  -- existence does not silently overwrite local with empty settings.
  INSERT INTO public.user_settings (user_id, last_reset_at, updated_at)
  VALUES (uid, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET last_reset_at = EXCLUDED.last_reset_at,
        updated_at    = EXCLUDED.updated_at;
END;
$$;
