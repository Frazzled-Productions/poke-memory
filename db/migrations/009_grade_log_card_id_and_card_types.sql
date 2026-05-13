-- Migration: 009_grade_log_card_id_and_card_types
--
-- Adds card_id so the FSRS optimizer can group reviews per card
-- (issue #268), and extends the card_type CHECK to include
-- `cry` and `reverse-evolution` which are already shipped client-side
-- but were filtered out of sync. With this migration the client filter
-- can be dropped.

ALTER TABLE grade_log ADD COLUMN card_id integer;
ALTER TABLE grade_log DROP CONSTRAINT IF EXISTS grade_log_card_type_check;
ALTER TABLE grade_log ADD CONSTRAINT grade_log_card_type_check
  CHECK (card_type IN ('name', 'evolution', 'reverse', 'reverse-evolution', 'cry'));
CREATE INDEX IF NOT EXISTS grade_log_user_card ON grade_log (user_id, card_id) WHERE card_id IS NOT NULL;
