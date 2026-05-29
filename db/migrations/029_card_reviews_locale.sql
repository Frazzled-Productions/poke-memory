-- Migration: 029_card_reviews_locale (#1259 follow-up)
--
-- Extends card_reviews and grade_log with a `locale` column so each
-- (user, card_type, subject_key, locale) tuple is an independent FSRS row.
-- Mastery, Pasture, Stats, and badges all scope to the user's current
-- pokemonNameLocale — switching language presents a fresh progress slate
-- while preserving prior rows (they are still there when the user switches back).
--
-- Backfills existing rows to locale = 'en' via the column DEFAULT.
-- No data migration script needed.
--
-- The regression trigger function is re-declared to include locale in every
-- RAISE EXCEPTION identity tuple for easier production triage.

-- ── card_reviews ────────────────────────────────────────────────────────────

ALTER TABLE card_reviews
  ADD COLUMN locale text NOT NULL DEFAULT 'en';

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_locale_check
  CHECK (locale IN ('en', 'ja', 'zh-Hans', 'zh-Hant'));

-- Drop the current PK (user_id, card_type, subject_key) and widen it to
-- include locale so each locale gets independent FSRS state.
ALTER TABLE card_reviews DROP CONSTRAINT card_reviews_pkey;
ALTER TABLE card_reviews
  ADD PRIMARY KEY (user_id, card_type, subject_key, locale);

-- ── Regression trigger — re-declare with locale in identity tuples ───────────
--
-- Re-creates the full function body from migration 017 (the latest version).
-- Only the RAISE EXCEPTION format strings change — ", locale=%" is appended to
-- every identity tuple so production triage can pinpoint which locale row fired.

CREATE OR REPLACE FUNCTION card_reviews_reject_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.last_review IS NOT NULL AND NEW.last_review IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot transition from % to NULL (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.last_review, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: first_seen cannot transition from % to NULL (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.first_seen, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review < OLD.last_review THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot move backward from % to % (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.last_review, NEW.last_review, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  -- reps and lapses are NOT NULL by schema constraint, so the comparison is a
  -- straightforward integer comparison; no explicit NULL guard is needed.
  IF NEW.reps < OLD.reps THEN
    RAISE EXCEPTION
      'card_reviews regression: reps cannot decrease from % to % (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.reps, NEW.reps, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lapses < OLD.lapses THEN
    RAISE EXCEPTION
      'card_reviews regression: lapses cannot decrease from % to % (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.lapses, NEW.lapses, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review = OLD.last_review
     AND NEW.scheduled_days < OLD.scheduled_days THEN
    RAISE EXCEPTION
      'card_reviews regression: scheduled_days cannot drop from % to % without advancing last_review (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.scheduled_days, NEW.scheduled_days, OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  -- seen_in_pasture is NOT NULL DEFAULT false (migration 008). The one-way
  -- invariant: once acknowledged in the pasture, the flag never returns to
  -- false. Any client write of seen_in_pasture=false over a row with
  -- seen_in_pasture=true is a sync bug.
  IF OLD.seen_in_pasture = true AND NEW.seen_in_pasture = false THEN
    RAISE EXCEPTION
      'card_reviews regression: seen_in_pasture cannot transition from true to false (user_id=%, card_type=%, subject_key=%, locale=%)',
      OLD.user_id, OLD.card_type, OLD.subject_key, OLD.locale
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger binding.
DROP TRIGGER IF EXISTS card_reviews_reject_regression_trigger ON card_reviews;

CREATE TRIGGER card_reviews_reject_regression_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_reject_regression();

-- ── grade_log ────────────────────────────────────────────────────────────────
--
-- No CHECK constraint: card_type validation is app-boundary-only per
-- docs/card-identity.md. Same principle applies to locale here.
-- No index change: existing index is selective enough for per-user reads.

ALTER TABLE grade_log
  ADD COLUMN locale text NOT NULL DEFAULT 'en';
