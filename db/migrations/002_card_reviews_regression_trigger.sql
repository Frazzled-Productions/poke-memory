-- Migration: 002_card_reviews_regression_trigger
--
-- Defense in depth against client-side sync bugs that could clobber real
-- review state. See issue #295 (and the original incident in #293).
--
-- The bug class we're guarding against: a buggy client upserts rows with
-- last_review=NULL, first_seen=NULL over rows that previously had real
-- progress, irrecoverably destroying server-side data.
--
-- SM-2 mechanics legitimately reset repetitions / interval / ease_factor
-- on an "Again" grade, so those columns are NOT checked. The invariants
-- here are purely about the observable lifecycle timestamps: once a card
-- has been seen or reviewed, it stays that way. A future "reset progress"
-- or "delete account" flow will need a SECURITY DEFINER RPC that bypasses
-- this trigger; no such flow exists today.

CREATE OR REPLACE FUNCTION card_reviews_reject_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.last_review IS NOT NULL AND NEW.last_review IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot transition from % to NULL (user_id=%, pokemon_id=%)',
      OLD.last_review, OLD.user_id, OLD.pokemon_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL THEN
    RAISE EXCEPTION
      'card_reviews regression: first_seen cannot transition from % to NULL (user_id=%, pokemon_id=%)',
      OLD.first_seen, OLD.user_id, OLD.pokemon_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.last_review IS NOT NULL
     AND NEW.last_review IS NOT NULL
     AND NEW.last_review < OLD.last_review THEN
    RAISE EXCEPTION
      'card_reviews regression: last_review cannot move backward from % to % (user_id=%, pokemon_id=%)',
      OLD.last_review, NEW.last_review, OLD.user_id, OLD.pokemon_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS card_reviews_reject_regression_trigger ON card_reviews;

CREATE TRIGGER card_reviews_reject_regression_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_reject_regression();
