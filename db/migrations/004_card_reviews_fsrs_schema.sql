-- Migration: 004_card_reviews_fsrs_schema
--
-- Swap card_reviews from SM-2 columns to FSRS columns. Backfills existing
-- rows from the SM-2 fields using the same formula as the localStorage
-- migrateReviewState (lib/review/persistence.ts) and the cloud-boundary
-- adapter that #263 ships, then drops the SM-2 columns.
--
-- The regression trigger from migration 002 references only last_review
-- and first_seen — those persist — so the trigger continues to function
-- unchanged.
--
-- ROLLOUT ORDERING (important): apply this migration to the live project
-- only after #263 has merged to main and deployed. Deploying #264 against
-- a Supabase project that still has the SM-2 schema, or applying this
-- migration while the production client is still on SM-2 fields, breaks
-- sync in the gap. See PR description for the safe sequence.

-- 1. Add FSRS columns (nullable initially so backfill can run).
ALTER TABLE card_reviews
  ADD COLUMN stability      numeric,
  ADD COLUMN difficulty     numeric,
  ADD COLUMN elapsed_days   integer,
  ADD COLUMN scheduled_days integer,
  ADD COLUMN reps           integer,
  ADD COLUMN lapses         integer,
  ADD COLUMN fsrs_state     text;

-- 2. Backfill from SM-2 columns. Mirrors migrateReviewState() in
--    lib/review/persistence.ts exactly: brand-new rows zero out FSRS
--    fields; graduated rows derive stability/difficulty from interval and
--    ease_factor.
UPDATE card_reviews
SET
  stability      = CASE WHEN repetitions = 0 AND last_review IS NULL
                        THEN 0
                        ELSE GREATEST(1, interval)
                   END,
  difficulty     = CASE WHEN repetitions = 0 AND last_review IS NULL
                        THEN 0
                        ELSE LEAST(10, GREATEST(1, 10 - 9 * (ease_factor - 1.3) / 1.2))
                   END,
  elapsed_days   = 0,
  scheduled_days = COALESCE(interval, 0),
  reps           = COALESCE(repetitions, 0),
  lapses         = 0,
  fsrs_state     = CASE WHEN repetitions = 0 AND last_review IS NULL
                        THEN 'new'
                        ELSE 'review'
                   END;

-- 3. Enforce NOT NULL with sensible defaults so future inserts can omit
--    the FSRS fields and still produce a valid row (defaults match an
--    untouched, brand-new card).
ALTER TABLE card_reviews
  ALTER COLUMN stability      SET NOT NULL,
  ALTER COLUMN difficulty     SET NOT NULL,
  ALTER COLUMN elapsed_days   SET NOT NULL,
  ALTER COLUMN scheduled_days SET NOT NULL,
  ALTER COLUMN reps           SET NOT NULL,
  ALTER COLUMN lapses         SET NOT NULL,
  ALTER COLUMN fsrs_state     SET NOT NULL,
  ALTER COLUMN stability      SET DEFAULT 0,
  ALTER COLUMN difficulty     SET DEFAULT 0,
  ALTER COLUMN elapsed_days   SET DEFAULT 0,
  ALTER COLUMN scheduled_days SET DEFAULT 0,
  ALTER COLUMN reps           SET DEFAULT 0,
  ALTER COLUMN lapses         SET DEFAULT 0,
  ALTER COLUMN fsrs_state     SET DEFAULT 'new';

-- 4. Reject unknown fsrs_state labels.
ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_fsrs_state_check
  CHECK (fsrs_state IN ('new', 'learning', 'review', 'relearning'));

-- 5. Drop the SM-2 columns.
ALTER TABLE card_reviews
  DROP COLUMN repetitions,
  DROP COLUMN interval,
  DROP COLUMN ease_factor;
