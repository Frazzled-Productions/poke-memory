-- Migration 020: add CHECK constraints bounding stability and difficulty
-- on card_reviews. Issue #521.
--
-- FSRS specifies:
--   difficulty ∈ [1, 10] during active scheduling.
--   difficulty = 0 is the new-card sentinel (written by reset_all_progress in
--   migration 018 and by the initial upsert before any grade is recorded).
--   difficulty = 1 is the FSRS algorithm minimum for an active card; the
--   constraint allows 0 so new-card rows are not violated.
--
--   stability  ∈ [0, 36500] days.
--   stability = 0 is likewise the new-card sentinel.
--   36500 mirrors ts-fsrs's internal clamp (~100 years), closing the gap
--   against a future client bug or direct DB write storing an unbounded value
--   that the scheduler would treat as essentially permanent mastery.
--
-- Pre-flight audit run before applying:
--   SELECT COUNT(*) FILTER (WHERE difficulty < 0 OR difficulty > 10),
--          COUNT(*) FILTER (WHERE stability < 0 OR stability > 36500)
--   FROM card_reviews;
-- Result: 0, 0 (16 rows scanned).

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_difficulty_range
    CHECK (difficulty >= 0 AND difficulty <= 10);

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_stability_range
    CHECK (stability >= 0 AND stability <= 36500);
