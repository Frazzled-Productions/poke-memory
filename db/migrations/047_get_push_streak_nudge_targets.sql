-- Migration: 047_get_push_streak_nudge_targets (#1950)
--
-- Two SECURITY DEFINER read RPCs for the new late-day "streak at risk" push
-- (app/api/push/send-streak-nudge/route.ts), mirroring the narrowing pattern
-- migration 046 established for the daily reminder route: the service-role
-- key's cross-user read surface is narrowed from "can SELECT anything" to
-- two functions with explicit, minimal return contracts.
--
--   get_push_streak_days(user_ids)              - every streak_days row for
--                                                  the candidate users, so the
--                                                  route can compute each
--                                                  user's current streak
--                                                  length in TypeScript
--                                                  (existing streak-derivation
--                                                  logic stays there, not
--                                                  reimplemented in SQL).
--   get_push_reviewed_today(user_ids, today)     - which of those users have
--                                                  already reviewed today, so
--                                                  the route can cheaply drop
--                                                  them before doing the
--                                                  heavier streak-length work.
--
-- SECURITY MODEL (identical to migration 046)
--   - SECURITY DEFINER with SET search_path = ''; every relation is
--     schema-qualified.
--   - EXECUTE revoked from PUBLIC, anon, and authenticated: both functions
--     read across every user's rows. Granted to service_role only - the
--     route's admin client.
--   - STABLE: read-only, safe for PostgREST to call via GET or POST.
--
-- INDEX CHECK (see AGENTS.md persistence runbook - "is a new index needed?")
--   streak_days:   UNIQUE (user_id, review_date) from migration 001 already
--                  leads with user_id, so `user_id = ANY(user_ids)` is served
--                  by the existing unique index. No new index added.
--   card_reviews:  PRIMARY KEY (user_id, card_type, subject_key, locale) from
--                  migrations 012/029 already leads with user_id. Migration
--                  039 explicitly declined a standalone user_id index on this
--                  table for the same reason. get_push_due_cards (046) filters
--                  on due_date with no secondary index on that column;
--                  get_push_reviewed_today follows the identical pattern for
--                  last_review. No new index added.
--
-- CRON WIRING
--   A new hourly pg_cron job, 'web-push-streak-nudge', calls the new route at
--   the Vault-stored URL 'push_streak_nudge_send_url', reusing the existing
--   'cron_shared_secret'. Hourly (not once-daily) so the route's own
--   per-user local-hour gate (mirroring notificationHour.ts from #1315) can
--   fire the "late in the user's local day" send at the correct UTC hour for
--   each timezone, exactly as migration 031 did for the primary reminder.
--   The DO/EXCEPTION wrapping is copied verbatim from migrations 028/031/034
--   so the stock postgres:15 CI integration container (no pg_cron/pg_net)
--   degrades to a NOTICE instead of aborting the migration apply.
--
-- MANUAL SETUP REQUIRED AFTER MERGE (mirrors migration 028's VAPID/Vault note)
--   Populate Supabase Vault (BOTH prod and QA projects) with the new URL:
--     INSERT INTO vault.secrets (name, secret) VALUES
--       ('push_streak_nudge_send_url', 'https://pokememory.com/api/push/send-streak-nudge');
--   No new shared secret is needed - 'cron_shared_secret' from migration 028
--   already exists in Vault and is reused by the Authorization header below.
--   Until the Vault row exists, the cron job fires hourly but posts to a NULL
--   URL - harmless, but visible in cron.job_run_details.

-- -- get_push_streak_days --------------------------------------------------
-- Every streak_days row for the given candidate users. The route derives
-- each user's current streak length from the returned date set in
-- TypeScript (reusing the existing streak-derivation helper), the same way
-- get_push_due_cards (046) leaves due-count aggregation to the route.
CREATE OR REPLACE FUNCTION public.get_push_streak_days(user_ids uuid[])
RETURNS TABLE (
  user_id     uuid,
  review_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
  SELECT
    sd.user_id,
    sd.review_date
  FROM public.streak_days sd
  WHERE sd.user_id = ANY (user_ids)
  ORDER BY sd.user_id, sd.review_date;
$func$;

-- -- get_push_reviewed_today -----------------------------------------------
-- Which of the candidate users already reviewed today, so the route can
-- cheaply drop them before computing streak length. Distinct because a user
-- can have many card_reviews rows with last_review = today_input.
CREATE OR REPLACE FUNCTION public.get_push_reviewed_today(
  user_ids    uuid[],
  today_input date
)
RETURNS TABLE (
  user_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
  SELECT DISTINCT cr.user_id
  FROM public.card_reviews cr
  WHERE cr.last_review = today_input
    AND cr.user_id = ANY (user_ids);
$func$;

-- -- Grants -----------------------------------------------------------------
-- Functions default to EXECUTE for PUBLIC; strip that, then grant only the
-- service_role the route's admin client uses. anon/authenticated are revoked
-- explicitly for clarity even though removing PUBLIC already excludes them.
REVOKE EXECUTE ON FUNCTION public.get_push_streak_days(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_streak_days(uuid[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_push_reviewed_today(uuid[], date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_reviewed_today(uuid[], date) TO service_role;

-- -- pg_cron: hourly streak-nudge dispatch ---------------------------------
-- Unschedule any existing job first (idempotent re-apply guard, matching
-- migration 031's cron.unschedule-then-schedule sequence).
DO $do$
BEGIN
  PERFORM cron.unschedule('web-push-streak-nudge');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.unschedule (pg_cron not available or job not found): %', SQLERRM;
END
$do$;

DO $do$
BEGIN
  PERFORM cron.schedule(
    'web-push-streak-nudge',
    '0 * * * *',
    $cronbody$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_streak_nudge_send_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cronbody$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.schedule (pg_cron not available): %', SQLERRM;
END
$do$;
