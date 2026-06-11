-- Add the 'feedback' action to check_rate_limit so the per-IP throttle added to
-- /api/feedback (#1860 F28/F32) works instead of hitting the RAISE EXCEPTION
-- branch (which broke all feedback submissions). Feedback is low-frequency:
-- 5 per 10 minutes, 20 per hour per IP. Also widen the action CHECK constraint
-- on rate_limit_buckets to permit 'feedback'. (#1883)
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_ip_hash text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $func$
DECLARE
  v_count_10m int;
  v_count_1h  int;
  v_cap_10m   int;
  v_cap_1h    int;
BEGIN
  IF p_action = 'signup' THEN
    v_cap_10m := 5;
    v_cap_1h  := 20;
  ELSIF p_action = 'signin' THEN
    v_cap_10m := 10;
    v_cap_1h  := 40;
  ELSIF p_action = 'feedback' THEN
    v_cap_10m := 5;
    v_cap_1h  := 20;
  ELSE
    RAISE EXCEPTION 'check_rate_limit: unknown action %', p_action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_count_10m
    FROM public.rate_limit_buckets
   WHERE ip_hash = p_ip_hash AND action = p_action
     AND attempted_at > now() - interval '10 minutes';
  IF v_count_10m >= v_cap_10m THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_count_1h
    FROM public.rate_limit_buckets
   WHERE ip_hash = p_ip_hash AND action = p_action
     AND attempted_at > now() - interval '1 hour';
  IF v_count_1h >= v_cap_1h THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_buckets (ip_hash, action)
  VALUES (p_ip_hash, p_action);
  RETURN true;
END;
$func$;

ALTER TABLE public.rate_limit_buckets DROP CONSTRAINT rate_limit_buckets_action_check;
ALTER TABLE public.rate_limit_buckets ADD CONSTRAINT rate_limit_buckets_action_check
  CHECK (action = ANY (ARRAY['signup'::text, 'signin'::text, 'feedback'::text]));
