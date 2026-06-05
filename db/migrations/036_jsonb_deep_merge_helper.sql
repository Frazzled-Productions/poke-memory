-- Migration 036: recursive JSONB deep-merge helper.
--
-- `public.jsonb_deep_merge(base, patch)` merges `patch` into `base` key-by-key.
-- When both sides have a JSON object at the same key, the merge recurses so that
-- a patch touching one nested field never blows away sibling keys.
--
-- Arrays are intentionally NOT deep-merged: the array as a whole is replaced by
-- the patch value (last-write-wins for the array). Array monotonicity (e.g. no
-- shrinking spendDates) is enforced by the 038 trigger; the client unions arrays
-- before pushing to avoid accidental truncation.
--
-- IMMUTABLE: depends only on its arguments, no side effects, no DB access.

CREATE OR REPLACE FUNCTION public.jsonb_deep_merge(base jsonb, patch jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  result jsonb := COALESCE(base, '{}');
  key   text;
  val   jsonb;
BEGIN
  FOR key, val IN SELECT * FROM jsonb_each(COALESCE(patch, '{}')) LOOP
    IF jsonb_typeof(val) = 'object' AND jsonb_typeof(result -> key) = 'object' THEN
      result := jsonb_set(result, ARRAY[key], public.jsonb_deep_merge(result -> key, val));
    ELSE
      result := jsonb_set(result, ARRAY[key], val, true);
    END IF;
  END LOOP;
  RETURN result;
END; $$;
