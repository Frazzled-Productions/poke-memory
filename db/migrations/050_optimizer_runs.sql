-- Migration: 050_optimizer_runs
--
-- Server-owned run limit for POST /api/srs/optimize, plus an IP bucket for it.
--
-- optimizer_runs holds one row per user: when their last fit was claimed. RLS is
-- on with no client policies (the rate_limit_buckets precedent, migration 041):
-- only claim_optimizer_slot() below touches it. The FK cascades, so account
-- deletion erases the row. reset_all_progress leaves it alone: a progress reset
-- is not a new optimiser slot.
--
-- claim_optimizer_slot() is one atomic statement. Concurrent callers serialise on
-- the row, and ON CONFLICT re-checks the WHERE against the committed row, so one
-- claim wins. A claim always spends the slot, whatever the fit then does, which is
-- why the route checks the grade log before claiming. A client calling the RPC
-- directly can only spend its own slot.
--
-- The window must match OPTIMIZER_COOLDOWN_MS in lib/srs/optimizer.ts, which the
-- Settings UI uses for its countdown. It is fixed here, not passed in, and
-- lib/sync/integration/optimizer-slot.test.ts holds the two together.
--
-- check_rate_limit learns the 'optimize' action: 3 per 10 minutes, 10 per hour.
-- The button runs at most weekly, so a person never reaches these. The whole
-- function is restated, as in migration 045.
--
-- user_settings.settings loses the old in-progress key, which nothing reads now.

CREATE TABLE public.optimizer_runs (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.optimizer_runs ENABLE ROW LEVEL SECURITY;
-- No client policies by design: all access goes through the SECURITY DEFINER RPC.

-- ---------------------------------------------------------------------------
-- claim_optimizer_slot() -> bigint
--
-- Returns 0 when the caller now holds the slot, otherwise the milliseconds until
-- it frees up. The user is always auth.uid(); there is no user parameter.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.claim_optimizer_slot()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid      uuid     := auth.uid();
  v_window interval := interval '7 days';
  v_left   bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'claim_optimizer_slot requires an authenticated session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.optimizer_runs AS runs (user_id, claimed_at)
  VALUES (uid, now())
  ON CONFLICT (user_id) DO UPDATE
    SET claimed_at = now()
    WHERE runs.claimed_at <= now() - v_window;

  IF FOUND THEN
    RETURN 0;
  END IF;

  SELECT ceil(extract(epoch FROM runs.claimed_at + v_window - now()) * 1000)::bigint
    INTO v_left
    FROM public.optimizer_runs AS runs
   WHERE runs.user_id = uid;

  RETURN v_left;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_optimizer_slot() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.claim_optimizer_slot() TO authenticated;

-- ---------------------------------------------------------------------------
-- check_rate_limit: add the 'optimize' action.
-- ---------------------------------------------------------------------------
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
  ELSIF p_action = 'optimize' THEN
    v_cap_10m := 3;
    v_cap_1h  := 10;
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
  CHECK (action = ANY (ARRAY['signup'::text, 'signin'::text, 'feedback'::text, 'optimize'::text]));

-- ---------------------------------------------------------------------------
-- Remove the in-progress key the route no longer writes.
-- ---------------------------------------------------------------------------
UPDATE public.user_settings
   SET settings = settings - 'fsrsOptimizingAt'
 WHERE settings ? 'fsrsOptimizingAt';
