-- Migration: 017_card_reviews_pasture_one_way
--
-- Extends card_reviews_reject_regression() with a one-way guard on
-- seen_in_pasture (introduced in #350 / migration 008). A client upsert
-- with seen_in_pasture=false over a row with seen_in_pasture=true is
-- always a sync bug — there is no legitimate user action that
-- un-acknowledges a pasture entry. See #513.
--
-- Also pins the function's search_path to empty so the linter
-- function_search_path_mutable warning clears for this function.
-- SET search_path = '' + fully qualified references (none needed in
-- this body — only column refs and RAISE EXCEPTION) follows the
-- pattern Supabase recommends for SECURITY INVOKER functions.

CREATE OR REPLACE FUNCTION card_reviews_reject_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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

  -- reps and lapses are NOT NULL by schema constraint, so the comparison is a
  -- straightforward integer comparison; no explicit NULL guard is needed.
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

  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review = OLD.last_review
     AND NEW.scheduled_days < OLD.scheduled_days THEN
    RAISE EXCEPTION
      'card_reviews regression: scheduled_days cannot drop from % to % without advancing last_review (user_id=%, card_type=%, subject_key=%)',
      OLD.scheduled_days, NEW.scheduled_days, OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  -- seen_in_pasture is NOT NULL DEFAULT false (migration 008). The one-way
  -- invariant: once acknowledged in the pasture, the flag never returns to
  -- false. Any client write of seen_in_pasture=false over a row with
  -- seen_in_pasture=true is a sync bug.
  IF OLD.seen_in_pasture = true AND NEW.seen_in_pasture = false THEN
    RAISE EXCEPTION
      'card_reviews regression: seen_in_pasture cannot transition from true to false (user_id=%, card_type=%, subject_key=%)',
      OLD.user_id, OLD.card_type, OLD.subject_key
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger binding in case it was ever dropped.
-- Note: the DROP / CREATE pair below is not wrapped in an explicit BEGIN/COMMIT.
-- The two DDL statements are adjacent and fast; the window where the trigger is
-- unbound is negligible in practice. If applying manually in a transaction, wrap
-- both statements together to close the window entirely.
DROP TRIGGER IF EXISTS card_reviews_reject_regression_trigger ON card_reviews;

CREATE TRIGGER card_reviews_reject_regression_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_reject_regression();
