-- Migration 021: block future-date streak rows. Issue #524.
-- (Migration 020 is assigned to the in-flight card_reviews bounds PR #521.)
--
-- Grace window +1 day accommodates UTC+14 clients (e.g. Line Islands, Kiribati)
-- who may legitimately insert a review_date that is "tomorrow" in UTC while
-- their local clock is still on today. A strict <= current_date would reject
-- legitimate streak rows from those timezones in the late-evening window.
--
-- RLS UPDATE/DELETE policies on streak_days were already dropped in
-- migration 018 (closing #515). This migration adds the remaining client-side
-- regression gap surfaced in #524.
--
-- Pre-flight audit ran before applying:
--   SELECT COUNT(*) FROM streak_days WHERE review_date > current_date + 1;
-- Result: 0 (4 rows scanned, max review_date = current_date).

ALTER TABLE streak_days
  ADD CONSTRAINT streak_days_no_future_date
    CHECK (review_date <= current_date + 1);
