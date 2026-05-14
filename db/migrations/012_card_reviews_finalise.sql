-- Migration 012: Finalise card_reviews — promote (user_id, card_type, subject_key) to PRIMARY KEY,
-- make subject_key NOT NULL, update regression-trigger RAISE strings, drop legacy pokemon_id.
--
-- Pre-flight (verified before applying):
--   SELECT COUNT(*) FROM card_reviews WHERE subject_key IS NULL → 0
-- All rows have subject_key set so SET NOT NULL is safe.

-- 1. Safety-net backfill (pre-flight V1 shows 0 remain, but defence in depth).
UPDATE card_reviews
SET subject_key = pokemon_id::text
WHERE subject_key IS NULL AND pokemon_id IS NOT NULL;

-- 2. Promote subject_key to NOT NULL.
ALTER TABLE card_reviews ALTER COLUMN subject_key SET NOT NULL;

-- 3. Update the regression-trigger RAISE strings to reference card_type / subject_key
--    instead of pokemon_id. The conditional logic is unchanged.
--    This MUST happen BEFORE DROP COLUMN pokemon_id (step 6).
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

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged; CREATE OR REPLACE on the function is enough.
-- Re-create the trigger binding in case it was ever dropped.
DROP TRIGGER IF EXISTS card_reviews_reject_regression_trigger ON card_reviews;

CREATE TRIGGER card_reviews_reject_regression_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_reject_regression();

-- 4. Drop the transitional partial unique index from migration 010.
DROP INDEX IF EXISTS card_reviews_pk_partial;

-- 5. Promote to real PRIMARY KEY.
ALTER TABLE card_reviews ADD PRIMARY KEY (user_id, card_type, subject_key);

-- 6. Drop the legacy pokemon_id column.
ALTER TABLE card_reviews DROP COLUMN pokemon_id;
