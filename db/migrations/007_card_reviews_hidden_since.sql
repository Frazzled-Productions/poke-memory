-- Migration: 007_card_reviews_hidden_since
--
-- Adds a per-card `hidden_since` date that tracks when a card first became
-- ineligible under the user's current learning filter (issue #333). Set when
-- a card is filtered out, cleared when it becomes eligible again. The
-- reconciliation step on session load shifts `due_date` forward by the
-- hidden duration so cards don't accumulate overdue debt while paused.
--
-- Nullable (most cards are never filtered), no default. No trigger change —
-- the column can be freely set and cleared, with no monotonic invariant.
-- The existing card_reviews_reject_regression_trigger from migration 002
-- guards lifecycle timestamps (last_review, first_seen) only; due_date can
-- still shift forward, which is exactly what reconciliation does.

ALTER TABLE card_reviews ADD COLUMN hidden_since date;
