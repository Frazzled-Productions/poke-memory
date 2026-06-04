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

-- 12-month retention purge via pg_cron (version 1.6.4, confirmed installed).
-- The DO block is idempotent: it unschedules any existing job by name before
-- scheduling, tolerating both first-apply and re-apply safely.
DO $$
BEGIN
  -- Unschedule if the job already exists (idempotent re-apply guard).
  PERFORM cron.unschedule('feedback-retention-purge')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'feedback-retention-purge'
  );

  -- Schedule a daily purge at 03:00 UTC to remove rows older than 12 months.
  PERFORM cron.schedule(
    'feedback-retention-purge',
    '0 3 * * *',
    $$DELETE FROM feedback WHERE created_at < now() - interval '12 months'$$
  );
END;
$$;
