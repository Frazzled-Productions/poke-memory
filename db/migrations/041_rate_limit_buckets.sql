-- Migration: 041_rate_limit_buckets
--
-- Per-IP throttle table and RPC for the username sign-up/sign-in Server
-- Actions (#1768). Protects against account-creation floods and username
-- enumeration via the password auth door.
--
-- DESIGN: append-only attempt rows + COUNT-in-window inside the RPC.
-- Each call to check_rate_limit() inserts one row (if allowed) and counts
-- existing rows in a sliding window. This is crash-safe and testable; a
-- single mutable counter row would have a TOCTOU gap.
--
-- NO user_id FK: callers are unauthenticated (pre-session). This is a
-- deliberate deviation from the new-table checklist in docs/persistence.md,
-- which requires a FK to auth.users. The FK is inapplicable here because
-- no auth.users row exists yet when sign-up throttle runs; including one
-- would be architecturally wrong. Documented here for auditor clarity.
--
-- RLS: enabled, but no client policies by design. All writes go through
-- the SECURITY DEFINER RPC (which bypasses RLS). Direct SELECT/INSERT
-- from the client is blocked; only the RPC function can write.
--
-- PRIVACY: raw IPs are NEVER stored. The Server Action hashes the IP
-- with a secret salt (RATE_LIMIT_SALT env var) using Node's crypto module
-- before calling the RPC. The 64-char hex CHECK enforces sha256 output.
--
-- MANUAL SETUP REQUIRED AFTER MERGE
--   Set RATE_LIMIT_SALT in Vercel (Production + Preview, server-side only,
--   NOT prefixed NEXT_PUBLIC_) to a random secret, e.g.:
--     openssl rand -base64 32
--   Without this env var the Server Action falls back to 'dev-salt', which
--   is insecure and must never be used in production. Mirror the VAPID-key
--   setup note from migration 028.
--
-- RETENTION: a pg_cron job purges rows older than 2 hours. The cron call
-- is wrapped in a DO/EXCEPTION block (established pattern from migrations
-- 028/031/034) so the stock postgres:15 integration test container, which
-- lacks pg_cron, degrades to a NOTICE rather than failing the migration.

CREATE TABLE public.rate_limit_buckets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash       text        NOT NULL CHECK (char_length(ip_hash) = 64),  -- sha256 hex
  action        text        NOT NULL CHECK (action IN ('signup', 'signin')),
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rlb_ip_hash_action_time
  ON public.rate_limit_buckets (ip_hash, action, attempted_at DESC);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- No client policies by design: all writes go through the SECURITY DEFINER
-- RPC below, which bypasses RLS. No SELECT policy either: the table is
-- purely internal to the throttle mechanism; no client read path is needed.

-- ---------------------------------------------------------------------------
-- check_rate_limit(p_ip_hash, p_action) -> boolean
--
-- Returns TRUE if the attempt is within the cap (and inserts a row).
-- Returns FALSE if the cap is exceeded (no insert).
--
-- Caps:
--   signup:  5 / 10 min,  20 / 1 hour
--   signin: 10 / 10 min,  40 / 1 hour
--
-- SECURITY DEFINER so the anon role can call it without direct table access.
-- search_path = '' prevents search_path injection.
-- Granted to anon + authenticated so both pre-session and post-session callers
-- can reach it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_ip_hash text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  ELSE
    RAISE EXCEPTION 'check_rate_limit: unknown action %', p_action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*)
    INTO v_count_10m
    FROM public.rate_limit_buckets
   WHERE ip_hash = p_ip_hash
     AND action  = p_action
     AND attempted_at > now() - interval '10 minutes';

  IF v_count_10m >= v_cap_10m THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
    INTO v_count_1h
    FROM public.rate_limit_buckets
   WHERE ip_hash = p_ip_hash
     AND action  = p_action
     AND attempted_at > now() - interval '1 hour';

  IF v_count_1h >= v_cap_1h THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_buckets (ip_hash, action)
  VALUES (p_ip_hash, p_action);

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Retention purge via pg_cron: delete rows older than 2 hours.
-- Wrapped in DO/EXCEPTION blocks (pattern from migrations 028/031/034) so
-- the stock postgres:15 CI integration container without pg_cron degrades
-- to a NOTICE rather than aborting the migration.
-- ---------------------------------------------------------------------------

-- Unschedule any existing job first (idempotent re-apply guard).
DO $$
BEGIN
  PERFORM cron.unschedule('rate-limit-buckets-purge');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.unschedule (pg_cron not available or job not found): %', SQLERRM;
END;
$$;

-- Schedule a purge every 30 minutes to keep the table small.
DO $$
BEGIN
  PERFORM cron.schedule(
    'rate-limit-buckets-purge',
    '*/30 * * * *',
    $cronbody$DELETE FROM public.rate_limit_buckets WHERE attempted_at < now() - interval '2 hours'$cronbody$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.schedule (pg_cron not available): %', SQLERRM;
END;
$$;
