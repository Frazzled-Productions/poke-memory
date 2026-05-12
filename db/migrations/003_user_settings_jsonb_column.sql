-- Migration: 003_user_settings_jsonb_column
--
-- The original user_settings schema (migration 001) had two flat columns
-- (max_new_per_day, max_reviews_per_day). The app's UserSettings type has
-- since grown into a richer object with per-card-type limits, theme flags,
-- and audio toggles. Adding a column per setting would ratchet the schema
-- on every UI change.
--
-- Add a `settings jsonb` column that stores the full UserSettings object.
-- The legacy flat columns are kept in place but ignored by the new sync
-- path; future cleanup can drop them once we're confident nothing reads them.
-- See issue #294.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
