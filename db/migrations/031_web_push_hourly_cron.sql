-- Migration: 031_web_push_hourly_cron
--
-- Flips the `web-push-daily-reminders` pg_cron job from daily (0 8 * * *)
-- to hourly (0 * * * *) to activate per-user notification hours (#1315,
-- phase 2 - follow-up issue #1364).
--
-- DEPLOY-ORDERING CONSTRAINT
-- This migration MUST only be applied AFTER #1315's route changes are live
-- in production. The gating logic in app/api/push/send-daily/route.ts
-- (shouldSendToUser) ensures each user is notified at most once per day, at
-- the UTC hour matching their chosen local hour (or 08:00 UTC by default).
-- Applying this migration before the gating route is live would send up to 24
-- notifications per day per user until the route deploy lands.
--
-- PRECONDITION SATISFIED: #1315 shipped in v0.10.24 (b79cf92c) and is live
-- in production. This migration is safe to apply.
--
-- WHAT CHANGES
-- The net.http_post body (URL, headers, auth, payload) is copied verbatim
-- from the original migration 028 cron schedule - only the cron expression
-- changes from '0 8 * * *' (once daily at 08:00 UTC) to '0 * * * *' (once
-- per hour at minute 0). cron.unschedule removes the old job first so the
-- re-schedule does not collide.
--
-- ONCE-PER-DAY GUARANTEE
-- The route's shouldSendToUser gate (lib/push/notificationHour.ts) compares
-- the current UTC hour against each user's effective UTC send-hour. Because
-- UTC hours are unique within a calendar day, and the cron fires at most once
-- per UTC hour, no user can receive more than one notification per day.
--
-- NULL preference behaviour (unchanged): users with no preferred hour stored
-- fall back to PUSH_DEFAULT_HOUR_UTC (8), matching the original 08:00 UTC
-- schedule exactly. No existing user loses their notification.
--
-- COST NOTE
-- Hourly pg_cron + pg_net means ~24x more cron executions per day. At our
-- scale (few dozen push subscriptions) most hourly runs touch zero or very
-- few subscriptions. Worth revisiting if the user base grows significantly.

-- pg_cron / pg_net are Supabase-managed extensions - available on production
-- Supabase but NOT on the stock postgres:15 image used by the CI integration
-- test container. Wrap every cron call in a DO block with an EXCEPTION clause
-- so CI degrades to a NOTICE rather than aborting the migration apply.
DO $do$
BEGIN
  PERFORM cron.unschedule('web-push-daily-reminders');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.unschedule (pg_cron not available or job not found): %', SQLERRM;
END
$do$;

DO $do$
BEGIN
  PERFORM cron.schedule(
    'web-push-daily-reminders',
    '0 * * * *',
    $cronbody$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_send_url'),
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
