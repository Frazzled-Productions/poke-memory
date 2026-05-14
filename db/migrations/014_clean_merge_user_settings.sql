-- Migration 014: clean up merge_user_settings — drop the dead WHERE clause on the DO UPDATE branch.
--
-- The ON CONFLICT (user_id) target already constrains the row being updated,
-- so the trailing `WHERE user_settings.user_id = p_user_id` clause in 011 was
-- redundant. This migration re-creates the function without that clause.

-- CREATE OR REPLACE is safe here: the function name, argument types, and return
-- type are identical to migration 011. Postgres only requires DROP + recreate
-- when the return type changes; since this migration only rewrites the body,
-- OR REPLACE is sufficient.
CREATE OR REPLACE FUNCTION merge_user_settings(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO user_settings (user_id, settings, updated_at)
  VALUES (p_user_id, p_patch, now())
  ON CONFLICT (user_id) DO UPDATE SET
    settings = user_settings.settings || p_patch,
    updated_at = now();
$$;
