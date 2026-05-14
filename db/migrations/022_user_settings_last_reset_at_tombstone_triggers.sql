-- Migration: 022_user_settings_last_reset_at_tombstone_triggers
--
-- Schema-level mitigation for the delete-resurrection class (#582 / #576).
-- The card_reviews regression trigger (migrations 002, 015–017) only fires
-- on UPDATE, so a row that was DELETEd by reset_all_progress and then
-- re-INSERTed by a stale client passes through unchanged. streak_days and
-- grade_log had no equivalent guard at all.
--
-- This migration:
--
-- 1. Adds `user_settings.last_reset_at TIMESTAMPTZ`. NULL = no reset has been
--    recorded for this user; non-NULL = the user has called
--    reset_all_progress at least once and any cloud writes dated before that
--    moment are resurrected stale data.
--
-- 2. Updates `reset_all_progress` to upsert `last_reset_at = now()`
--    atomically with the deletes. Existing user_settings row is preserved
--    (the JSONB blob and regional-prefs columns are untouched).
--
-- 3. Adds BEFORE INSERT triggers on card_reviews, streak_days, grade_log
--    that reject rows whose effective date is before `last_reset_at`. A
--    NULL `last_reset_at` short-circuits to allow all inserts (no reset
--    has happened, so no resurrection possible).
--
-- Trigger date-granularity rationale: comparing `date >= reset_at::date`
-- accepts same-day post-reset writes. The narrow loophole — a stale
-- device pushes a same-day pre-reset card after the reset — is acceptable
-- because the dates are already inside the user's "today" intent and
-- the dominant resurrection failure mode is multi-day-old stale data.

-- ─── 1. Column ──────────────────────────────────────────────────────────────

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ;

-- ─── 2. RPC update ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reset_all_progress()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'reset_all_progress requires an authenticated session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.card_reviews WHERE user_id = uid;
  DELETE FROM public.grade_log WHERE user_id = uid;
  DELETE FROM public.streak_days WHERE user_id = uid;
  -- Stamp the tombstone marker. If the user has never written settings,
  -- this insert creates the row; the JSONB column defaults to {} which
  -- pullSettings treats as "no real cloud settings" — so the row's
  -- existence does not silently overwrite local with empty settings.
  INSERT INTO public.user_settings (user_id, last_reset_at, updated_at)
  VALUES (uid, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET last_reset_at = EXCLUDED.last_reset_at,
        updated_at    = EXCLUDED.updated_at;
END;
$$;

-- ─── 3. Trigger functions + triggers ────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_pre_reset_card_reviews()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  reset_at TIMESTAMPTZ;
BEGIN
  SELECT us.last_reset_at INTO reset_at
    FROM public.user_settings us
    WHERE us.user_id = NEW.user_id;
  IF reset_at IS NULL THEN RETURN NEW; END IF;
  -- card_reviews carries two date columns; both must be on/after the reset
  -- date. first_seen pins the introduction; last_review pins the most
  -- recent grade. A stale client typically has both set to a pre-reset date.
  IF NEW.first_seen IS NOT NULL AND NEW.first_seen < reset_at::date THEN
    RAISE EXCEPTION
      'card_reviews: cannot INSERT row with first_seen % before last_reset_at % for user_id=%',
      NEW.first_seen, reset_at, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_review IS NOT NULL AND NEW.last_review < reset_at::date THEN
    RAISE EXCEPTION
      'card_reviews: cannot INSERT row with last_review % before last_reset_at % for user_id=%',
      NEW.last_review, reset_at, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS card_reviews_reject_pre_reset_trigger ON card_reviews;
CREATE TRIGGER card_reviews_reject_pre_reset_trigger
  BEFORE INSERT ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION reject_pre_reset_card_reviews();

CREATE OR REPLACE FUNCTION reject_pre_reset_streak_days()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  reset_at TIMESTAMPTZ;
BEGIN
  SELECT us.last_reset_at INTO reset_at
    FROM public.user_settings us
    WHERE us.user_id = NEW.user_id;
  IF reset_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.review_date < reset_at::date THEN
    RAISE EXCEPTION
      'streak_days: cannot INSERT row with review_date % before last_reset_at % for user_id=%',
      NEW.review_date, reset_at, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS streak_days_reject_pre_reset_trigger ON streak_days;
CREATE TRIGGER streak_days_reject_pre_reset_trigger
  BEFORE INSERT ON streak_days
  FOR EACH ROW
  EXECUTE FUNCTION reject_pre_reset_streak_days();

CREATE OR REPLACE FUNCTION reject_pre_reset_grade_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  reset_at TIMESTAMPTZ;
BEGIN
  SELECT us.last_reset_at INTO reset_at
    FROM public.user_settings us
    WHERE us.user_id = NEW.user_id;
  IF reset_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.entry_date < reset_at::date THEN
    RAISE EXCEPTION
      'grade_log: cannot INSERT row with entry_date % before last_reset_at % for user_id=%',
      NEW.entry_date, reset_at, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grade_log_reject_pre_reset_trigger ON grade_log;
CREATE TRIGGER grade_log_reject_pre_reset_trigger
  BEFORE INSERT ON grade_log
  FOR EACH ROW
  EXECUTE FUNCTION reject_pre_reset_grade_log();
