-- Migration 037: replace shallow `||` merge in merge_user_settings with
-- jsonb_deep_merge so a stale top-level patch can only change the fields it
-- actually set, never blow away nested keys like onboarding flags or
-- streakProtection sub-fields.
--
-- The function signature, ON CONFLICT (user_id) upsert, SET search_path = '',
-- and SECURITY INVOKER semantics are all preserved from migration 023.

CREATE OR REPLACE FUNCTION public.merge_user_settings(p_user_id uuid, p_patch jsonb)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.user_settings (user_id, settings, updated_at)
  VALUES (p_user_id, COALESCE(p_patch, '{}'), now())
  ON CONFLICT (user_id) DO UPDATE SET
    settings   = public.jsonb_deep_merge(
                   COALESCE(public.user_settings.settings, '{}'),
                   COALESCE(EXCLUDED.settings, '{}')
                 ),
    updated_at = now();
$$;
