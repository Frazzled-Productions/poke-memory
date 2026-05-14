-- Migration 019: add timezone and date_format columns to user_settings.
--
-- Both columns are nullable. NULL means "client hasn't set this yet — auto-detect
-- and write back". This avoids overwriting a user's deliberate choice with a
-- server-side default if they happen to sign in from a device with a different
-- locale. The client reads NULL as "run Intl auto-detection on first load".
--
-- These are scalar columns (not JSONB fields) because:
--   1. They are regional preferences, not card-progress state.
--   2. They need to be updateable without touching the settings JSONB blob,
--      since pushSettings() in lib/sync/settings.ts overwrites the whole
--      JSONB column. Writing to separate scalar columns avoids the LWW race
--      on the JSONB blob (see #517 audit for context).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS date_format TEXT
    CHECK (date_format IS NULL OR date_format IN ('iso', 'dmy', 'mdy'));
