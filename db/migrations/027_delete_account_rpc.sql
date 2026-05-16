-- Migration: 027_delete_account_rpc
--
-- Adds public.delete_account() — the self-serve full account erasure path
-- (issue #697).
--
-- WHY
-- reset_all_progress() (migration 018, extended in 026) wipes card/review data
-- but deliberately leaves the auth.users identity row and the user_settings
-- shell in place. Full account erasure was, until now, a manual email request.
-- This RPC closes that gap: it deletes the auth.users row itself, which
-- cascades through every FK'd table.
--
-- APPROACH — SECURITY DEFINER RPC over a service-role server route
-- The two ways to delete auth.users are (a) a SECURITY DEFINER function owned
-- by a superuser role, or (b) a server route calling auth.admin.deleteUser
-- with the service-role key. We pick (a): it mirrors the existing
-- reset_all_progress pattern (one centralised, auditable destructive RPC), and
-- it avoids introducing SUPABASE_SERVICE_ROLE_KEY as a new high-privilege
-- secret in the Next.js runtime. Deleting from auth.users requires elevated
-- privilege, which SECURITY DEFINER (the function runs as its postgres owner)
-- provides.
--
-- CASCADE
-- card_reviews, streak_days, user_settings, and grade_log all carry
--   user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
-- so the single DELETE FROM auth.users cascades to all four data tables. No
-- per-table DELETE is needed.
--
-- REGRESSION TRIGGER
-- card_reviews_reject_regression_trigger (migrations 002/015/016/017) is a
-- BEFORE UPDATE trigger — it does not fire on DELETE, so the cascade is not
-- blocked. No interaction with the trigger; no workaround required.
--
-- RLS
-- DELETE on auth.users is not reachable from the browser client regardless of
-- public-schema RLS — auth.users lives in the auth schema and the anon/
-- authenticated roles have no DELETE grant on it. This RPC is the only path.
-- It is scoped to auth.uid(): a caller can only ever delete their own account.

CREATE OR REPLACE FUNCTION delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'delete_account requires an authenticated session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Deleting the auth.users row cascades through the ON DELETE CASCADE FKs on
  -- card_reviews, streak_days, user_settings, and grade_log, so this single
  -- statement erases the identity and every row of user data atomically.
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION delete_account() TO authenticated;
