-- Daily counts of the one custom event, `app_open` (OpenSpec change move-to-cloudflare, design D9).
-- Written only by POST /api/event (lib/analytics/events.ts). Each row is one UTC day, the event
-- name and its two bucketed properties, with a count. No column can hold an IP address, user
-- agent, user id, page address, referrer or a time finer than the day.
CREATE TABLE events (
  day             TEXT    NOT NULL CHECK (length(day) = 10),  -- UTC date, YYYY-MM-DD
  name            TEXT    NOT NULL CHECK (name IN ('app_open')),
  user_type       TEXT    NOT NULL CHECK (user_type IN ('new', 'returning_guest', 'signed_in')),
  progress_bucket TEXT    NOT NULL CHECK (progress_bucket IN ('0', '1-10', '11-50', '50+')),
  count           INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, name, user_type, progress_bucket)
) STRICT;
