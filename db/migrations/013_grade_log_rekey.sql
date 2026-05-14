-- Migration 013: Rekey grade_log — replace integer card_id with (card_type, subject_key).
--
-- Pre-flight (verified before applying):
--   Total grade_log rows: 368
--   Rows with card_id >= 1_500_000 (edge IDs, unbackfillable): 100 → DROP
--   Rows with card_id IS NULL (pre-migration-009, unbackfillable): 182 → DROP
--   Rows remaining after drops: 86 (all in name/reverse/cry ranges)
--
-- Backfill direction uses the same offset scheme as the card_reviews migration 010:
--   name:    card_id 1..999_999      → subject_key = card_id::text
--   reverse: card_id 2_000_001..2_999_999 → subject_key = (card_id - 2_000_000)::text
--   cry:     card_id 3_000_001..3_999_999 → subject_key = (card_id - 3_000_000)::text

-- 1. Add subject_key (nullable for now; backfilled below, then NOT NULL).
ALTER TABLE grade_log ADD COLUMN subject_key text;

-- 2. Backfill non-edge rows by direction.

-- name cards: card_id 1..999_999
UPDATE grade_log
SET subject_key = card_id::text
WHERE card_id BETWEEN 1 AND 999999;

-- reverse cards: card_id 2_000_001..2_999_999
UPDATE grade_log
SET subject_key = (card_id - 2000000)::text
WHERE card_id BETWEEN 2000001 AND 2999999;

-- cry cards: card_id 3_000_001..3_999_999
UPDATE grade_log
SET subject_key = (card_id - 3000000)::text
WHERE card_id BETWEEN 3000001 AND 3999999;

-- 3. Drop edge rows (card_id in the 1_500_000..1_999_999 and 2_500_000..2_999_999 ranges
--    that encoded evolution-edge / reverse-evolution-edge cards). Per pre-flight: 100 rows.
DELETE FROM grade_log WHERE card_id >= 1500000 AND card_id < 2000000;

-- 4. Drop rows where card_id IS NULL — pre-migration-009 entries with no card identity.
--    Per pre-flight: 182 rows.
DELETE FROM grade_log WHERE card_id IS NULL;

-- 5. Enforce NOT NULL now that all remaining rows have subject_key set.
ALTER TABLE grade_log ALTER COLUMN subject_key SET NOT NULL;

-- 6. Drop the old index on card_id (created in migration 009).
DROP INDEX IF EXISTS grade_log_user_card;

-- 7. Drop the grade_log_card_type_check CHECK constraint (created in migration 009,
--    relaxed form of the original migration 006 constraint). card-identity.md records
--    the decision to validate card_type at the app boundary, not the DB layer.
ALTER TABLE grade_log DROP CONSTRAINT IF EXISTS grade_log_card_type_check;

-- 8. Drop the legacy card_id column.
ALTER TABLE grade_log DROP COLUMN card_id;

-- 9. New composite index replacing grade_log_user_card.
CREATE INDEX grade_log_user_subject ON grade_log (user_id, card_type, subject_key);
