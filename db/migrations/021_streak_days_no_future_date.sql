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
-- IMPORTANT: current_date is STABLE (not IMMUTABLE) in PostgreSQL. This
-- CHECK constraint is enforced at INSERT/UPDATE time only — it evaluates
-- current_date at the moment of each write. Do NOT run
-- ALTER TABLE streak_days VALIDATE CONSTRAINT streak_days_no_future_date
-- after the fact: validation evaluates current_date at that instant and
-- would incorrectly flag every historical row as a violation.
--
-- Pre-flight audit ran before applying:
--   SELECT COUNT(*) FROM streak_days WHERE review_date > current_date + 1;
-- Result: 0 (4 rows scanned, max review_date = current_date).

ALTER TABLE streak_days
  ADD CONSTRAINT streak_days_no_future_date
    CHECK (review_date <= current_date + 1);  -- date + integer yields a date in Postgres
