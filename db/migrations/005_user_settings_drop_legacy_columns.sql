-- Migration: 005_user_settings_drop_legacy_columns
--
-- The original user_settings schema (migration 001) had two flat columns —
-- max_new_per_day and max_reviews_per_day — that predate the per-card-type
-- limit feature. Since #294 / migration 003 added the `settings jsonb`
-- column as the canonical settings store, the flat columns are unread and
-- unwritten by every code path. Drop them so the table is honest about
-- what it stores. See issue #306.

ALTER TABLE user_settings
  DROP COLUMN max_new_per_day,
  DROP COLUMN max_reviews_per_day;
