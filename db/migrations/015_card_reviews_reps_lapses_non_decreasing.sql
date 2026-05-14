-- Migration: 015_card_reviews_reps_lapses_non_decreasing
--
-- Extends card_reviews_reject_regression() (originally added in 002) so the
-- trigger also blocks an UPDATE that decreases reps or lapses. FSRS only
-- ever monotonically increments these counters; a decrease is always a
-- sync bug. See issue #511 and the 2026-05-14 incident (a corrupted local
-- IDB session would have written reps=1 over cloud rows with reps=3 had
-- the user re-graded).
--
-- The function is re-declared in full so the migration is self-contained
-- and re-running it on a database already at 002 (or 015) is idempotent.

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

  IF NEW.reps < OLD.reps THEN
    RAISE EXCEPTION
      'card_reviews regression: reps cannot decrease from % to % (user_id=%, pokemon_id=%)',
      OLD.reps, NEW.reps, OLD.user_id, OLD.pokemon_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lapses < OLD.lapses THEN
    RAISE EXCEPTION
      'card_reviews regression: lapses cannot decrease from % to % (user_id=%, pokemon_id=%)',
      OLD.lapses, NEW.lapses, OLD.user_id, OLD.pokemon_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
