-- Migration 020: add CHECK constraints bounding stability and difficulty
-- on card_reviews.
--
-- FSRS specifies:
--   difficulty ∈ [1, 10] during active scheduling; 0 is the new-card sentinel.
--   stability  ≥ 0;       0 is the new-card sentinel.
--
-- Pre-flight: run this query before applying and confirm the result is 0.
--   SELECT COUNT(*) FROM card_reviews
--    WHERE difficulty < 0 OR difficulty > 10 OR stability < 0;
-- If the count is non-zero, stop and report before proceeding.

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_difficulty_range
    CHECK (difficulty >= 0 AND difficulty <= 10);

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_stability_non_negative
    CHECK (stability >= 0);
