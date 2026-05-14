-- Migration: 016_card_reviews_scheduled_days_regression
--
-- Extends card_reviews_reject_regression() with a guard against same-day
-- scheduled_days regressions. We can't make scheduled_days strictly
-- non-decreasing because FSRS legitimately resets it on an Again grade,
-- but Again always advances last_review to today. So the invariant is:
-- if last_review didn't move forward, scheduled_days can't drop.
--
-- Catches stale-state clobbers (the 2026-05-14 incident class) without
-- blocking real Again grades, real new grades on a future date, or
-- legitimate scheduling refinements that move both fields forward.
--
-- The function is re-declared in full so the migration is self-contained
-- and re-applying it on a database at 002/015/016 is idempotent. See #512.

CREATE OR REPLACE FUNCTION card_reviews_reject_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.last_review IS NOT NULL AND NEW.last_review IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot transition from % to NULL (user_id=%, card_type=%, subject_key=%)',
      OLD.last_review, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: first_seen cannot transition from % to NULL (user_id=%, card_type=%, subject_key=%)',
      OLD.first_seen, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review < OLD.last_review THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot move backward from % to % (user_id=%, card_type=%, subject_key=%)',
      OLD.last_review, NEW.last_review, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  -- reps and lapses are NOT NULL columns (enforced by schema), so NULL < OLD.reps
  -- evaluates to NULL in PL/pgSQL and the guard never fires — the column constraint
  -- is the defence against NULL here, matching the pattern of the guards above.
  IF NEW.reps < OLD.reps THEN
    RAISE EXCEPTION
      'card_reviews regression: reps cannot decrease from % to % (user_id=%, card_type=%, subject_key=%)',
      OLD.reps, NEW.reps, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lapses < OLD.lapses THEN
    RAISE EXCEPTION
      'card_reviews regression: lapses cannot decrease from % to % (user_id=%, card_type=%, subject_key=%)',
      OLD.lapses, NEW.lapses, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  -- scheduled_days is allowed to drop on a real Again grade (which advances
  -- last_review to today), but a same-date drop is always a stale-state
  -- clobber. scheduled_days is also NOT NULL, so the NULL-handling reasoning
  -- above applies here too.
  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review = OLD.last_review
     AND NEW.scheduled_days < OLD.scheduled_days THEN
    RAISE EXCEPTION
      'card_reviews regression: scheduled_days cannot drop from % to % without advancing last_review (user_id=%, card_type=%, subject_key=%)',
      OLD.scheduled_days, NEW.scheduled_days, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger binding in case it was ever dropped.
DROP TRIGGER IF EXISTS card_reviews_reject_regression_trigger ON card_reviews;

CREATE TRIGGER card_reviews_reject_regression_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_reject_regression();
