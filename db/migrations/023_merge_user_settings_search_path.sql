-- Migration: 023_merge_user_settings_search_path
--
-- Supabase advisor lint 0011 (function_search_path_mutable):
-- `public.merge_user_settings(uuid, jsonb)` did not pin its search_path. A
-- function with a mutable role-controlled search_path can be hijacked by an
-- attacker who creates same-named objects in a schema earlier on the resolved
-- path. The companion `reset_all_progress` RPC (migration 018) already follows
-- this pattern; bring this one in line.
--
-- Setting `search_path = ''` and fully-qualifying the `user_settings`
-- reference is the canonical Supabase recommendation.

CREATE OR REPLACE FUNCTION merge_user_settings(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.user_settings (user_id, settings, updated_at)
  VALUES (p_user_id, p_patch, now())
  ON CONFLICT (user_id) DO UPDATE SET
    settings = public.user_settings.settings || p_patch,
    updated_at = now();
$$;
