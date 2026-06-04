-- Migration 034: feedback table (#1621)
--
-- Adds a `feedback` table for in-app bug reports and feature requests.
-- Writes go through the service-role Route Handler; there is no client write path.
--
-- MAINTAINER DECISION (privacy-expert): `user_id` uses ON DELETE CASCADE (not SET NULL).
-- Rationale: SET NULL would retain the free-text `message` (possible PII typed by the user)
-- indefinitely after account deletion, a weaker UK-GDPR Art.17 erasure posture.
-- CASCADE removes the feedback row when the user account is deleted, achieving a clean erasure.
--
-- A 12-month retention purge is scheduled via pg_cron to remove old rows regardless of
-- whether the account still exists. This complements the CASCADE by purging guest feedback
-- (user_id = NULL) and old authenticated feedback not yet caught by account deletion.

CREATE TABLE IF NOT EXISTS feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  category    text        NOT NULL CHECK (category IN ('bug', 'feature', 'other')),
  message     text        NOT NULL,
  page        text,
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- No regression trigger: feedback is write-once append-only with no UPDATE path.

-- Enable RLS. No client-side policies by design: all writes via service-role;
-- no client read path required. The service-role INSERT bypasses RLS entirely.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- 12-month retention purge via pg_cron (version 1.6.4 on Supabase production).
-- pg_cron is a Supabase-managed extension, available on production but NOT in
-- the stock postgres:15 integration-test container. Each cron call is wrapped
-- in its own DO block with an EXCEPTION clause so a CI environment without the
-- `cron` schema degrades to a NOTICE rather than aborting the migration
-- (matching the established pattern in migrations 028 and 031). On production
-- the blocks behave as normal cron.unschedule / cron.schedule calls. The inner
-- command uses a distinct $cronbody$ tag so it does not terminate the DO block.

-- Unschedule any existing job first (idempotent re-apply guard).
DO $$
BEGIN
  PERFORM cron.unschedule('feedback-retention-purge');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.unschedule (pg_cron not available or job not found): %', SQLERRM;
END;
$$;

-- Schedule a daily purge at 03:00 UTC to remove rows older than 12 months.
DO $$
BEGIN
  PERFORM cron.schedule(
    'feedback-retention-purge',
    '0 3 * * *',
    $cronbody$DELETE FROM feedback WHERE created_at < now() - interval '12 months'$cronbody$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.schedule (pg_cron not available): %', SQLERRM;
END;
$$;
