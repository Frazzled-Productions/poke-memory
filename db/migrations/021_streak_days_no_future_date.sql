-- Migration 021: block future-date streak rows. Issue #524.
-- (Migration 020 is reserved for the in-flight card_reviews bounds PR #521.
--  If #521 is abandoned, slot 020 remains permanently empty — this is
--  intentional and does not affect any tooling; check-migrations.mjs matches
--  by derived name, not sequential number.)
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
-- NOTE: current_date is STABLE (not IMMUTABLE) in PostgreSQL — it evaluates
-- to the date at the moment of each INSERT/UPDATE, not a stored constant. All
-- existing rows were validated immediately when this constraint was applied
-- (no NOT VALID flag was used), so no separate VALIDATE CONSTRAINT step exists.
--
-- Pre-flight audit ran before applying:
--   SELECT COUNT(*) FROM streak_days WHERE review_date > current_date + 1;
-- Result: 0 (4 rows scanned, max review_date = current_date).

ALTER TABLE streak_days
  ADD CONSTRAINT streak_days_no_future_date
    CHECK (review_date <= current_date + 1);  -- date + integer yields a date in Postgres
