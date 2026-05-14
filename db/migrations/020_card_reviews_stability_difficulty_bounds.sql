-- Migration 020: add CHECK constraints bounding stability and difficulty
-- on card_reviews. Issue #521.
--
-- FSRS specifies:
--   difficulty ∈ [1, 10] during active scheduling; 0 is the new-card sentinel.
--   stability  ≥ 0;       0 is the new-card sentinel.
--
-- Both constraints allow 0 so existing new-card rows (fsrs_state = 'new') and
-- rows written by reset_all_progress (migration 018) — which sets both to 0 —
-- are not violated.
--
-- Pre-flight audit run before applying:
--   SELECT COUNT(*) FILTER (WHERE difficulty < 0 OR difficulty > 10),
--          COUNT(*) FILTER (WHERE stability < 0)
--   FROM card_reviews;
-- Result: 0, 0 (16 rows scanned).

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_difficulty_range
    CHECK (difficulty >= 0 AND difficulty <= 10);

ALTER TABLE card_reviews
  ADD CONSTRAINT card_reviews_stability_non_negative
    CHECK (stability >= 0);
