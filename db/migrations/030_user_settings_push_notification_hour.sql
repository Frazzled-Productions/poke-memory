-- Migration 030: Add push_notification_hour to user_settings.
--
-- Stores the user's preferred hour (0-23, local clock) for the daily push
-- notification. NULL means "no preference set"; the send-daily route then
-- falls back to PUSH_DEFAULT_HOUR_UTC (8 = 08:00 UTC).
--
-- The value is stored in the user's LOCAL clock hour (in their timezone),
-- not UTC. The route converts to UTC using Intl.DateTimeFormat at send time,
-- which handles DST correctly without storing a fixed offset.
--
-- This column lives on user_settings (alongside timezone / date_format) as a
-- scalar column rather than inside the JSONB blob for the same reason as those
-- two: a dedicated write path (pushRegionalPrefs) keeps the regional-prefs
-- update isolated from the last-write-wins JSONB merge path (pushSettings).
-- A concurrent pushSettings on another device will never null this column out.
--
-- RLS: no new policy needed. user_settings already has SELECT + INSERT + UPDATE
-- policies (the UPDATE policy was added when the table became writable for
-- regional prefs). This ALTER merely adds a column to the guarded row.
--
-- No pg_cron change in this migration. The cron schedule remains daily
-- (0 8 * * *). A separate phase-2 migration (031) will flip it to hourly
-- ONLY after this PR has been promoted to production — see the follow-up issue
-- filed alongside #1315.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS push_notification_hour smallint
    CHECK (push_notification_hour IS NULL OR (push_notification_hour >= 0 AND push_notification_hour <= 23));
