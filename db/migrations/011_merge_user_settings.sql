-- Migration: 011_merge_user_settings
--
-- Adds a SQL function that atomically merges a JSONB patch into
-- user_settings.settings via INSERT ... ON CONFLICT DO UPDATE (jsonb ||).
-- This eliminates the read-merge-write pattern in the FSRS optimizer route
-- and closes the race window that AutoSyncOnChange.pushSettings could open.
-- See issue #392.
--
-- The function executes as the calling authenticated user, so the existing
-- RLS policies on user_settings continue to guard cross-user access.
--
-- No SECURITY DEFINER — the call runs with the invoker's role so RLS applies.

-- Atomically merge a JSONB patch into user_settings.settings.
-- Executes as the authenticated user so RLS protects against cross-user writes.
CREATE OR REPLACE FUNCTION merge_user_settings(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO user_settings (user_id, settings, updated_at)
  VALUES (p_user_id, p_patch, now())
  ON CONFLICT (user_id) DO UPDATE SET
    settings = user_settings.settings || p_patch,
    updated_at = now()
  WHERE user_settings.user_id = p_user_id;
$$;
