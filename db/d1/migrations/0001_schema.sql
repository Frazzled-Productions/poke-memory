-- Poké Memory app schema for Cloudflare D1: the final state of the Postgres
-- migrations db/migrations/001 to 051, translated to SQLite (decision 0018,
-- openspec/changes/move-to-cloudflare/design.md D3). db/migrations/ stays as
-- history until the 14-day fallback ends.
--
-- Translation rules:
--   uuid            -> TEXT; new ids are random v4 UUIDs (same shape as the
--                      ids copied from Supabase).
--   timestamptz     -> TEXT, ISO 8601 UTC with milliseconds
--                      ('2026-11-19T10:00:00.000Z', default strftime(...,'now')).
--                      lib/db/scope.ts normalises written values to this
--                      shape, so string order is time order.
--   date            -> TEXT 'YYYY-MM-DD', CHECK (x IS date(x)).
--   jsonb           -> TEXT CHECK (json_valid(x)).
--   boolean         -> INTEGER 0/1 with CHECK (x IN (0, 1)).
--   numeric         -> REAL; smallint/integer/bigint -> INTEGER.
--   auth.users(id)  -> "user"(id), Better Auth's table (0002_auth.sql). SQLite
--                      accepts the forward reference and checks it at write time.
--   RLS policies    -> none: lib/db/scope.ts pins every query to the session
--                      user (design D4).
--   BEFORE trigger assigning NEW.x -> AFTER trigger issuing an UPDATE.
--   CHECK using current_date -> BEFORE triggers (SQLite CHECKs must be deterministic).
--   regex CHECK (~) -> GLOB and substr() checks.
--   RAISE EXCEPTION ... USING ERRCODE = 'check_violation'
--                   -> RAISE(ABORT, 'check_violation: <static text>'). The
--                      prefix is what lib/db/errors.ts maps to code 23514.
--
-- Not translated, ported to Worker code instead (design D3):
--   merge_user_settings / jsonb_deep_merge (011, 014, 023, 036, 037), the
--   user_settings regression guard (038), reset_all_progress (018, 022, 026),
--   delete_account (027), reconcile_grade_log_orphans (032), check_rate_limit
--   (041, 045), get_push_targets / get_push_due_cards / get_push_streak_days
--   (046, 047), the Discord notify triggers (042, 051) and every pg_cron job
--   (031, 034, 041, 042, 047: Cron Triggers, lib/cron/schedule.ts).
-- Dropped: the usernames table (035, 044). Better Auth's "user".username
-- holds the username; its format checks are in 0002_auth.sql.

-- ── card_reviews (001, 004, 007, 008, 010, 012, 020, 029, 043) ─────────────
-- One FSRS row per (user, card_type, subject_key, locale). The id column
-- outlived its primary key (010) and is kept for a like-for-like copy.
CREATE TABLE card_reviews (
  id              TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  card_type       TEXT NOT NULL,
  subject_key     TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en'
                  CONSTRAINT card_reviews_locale_check
                  CHECK (locale IN ('en', 'ja', 'zh-Hans', 'zh-Hant')),
  due_date        TEXT NOT NULL CHECK (due_date IS date(due_date)),
  last_review     TEXT CHECK (last_review IS date(last_review)),
  first_seen      TEXT CHECK (first_seen IS date(first_seen)),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  stability       REAL NOT NULL DEFAULT 0
                  CONSTRAINT card_reviews_stability_non_negative CHECK (stability >= 0),
  difficulty      REAL NOT NULL DEFAULT 0
                  CONSTRAINT card_reviews_difficulty_range CHECK (difficulty >= 0 AND difficulty <= 10),
  elapsed_days    INTEGER NOT NULL DEFAULT 0,
  scheduled_days  INTEGER NOT NULL DEFAULT 0,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  fsrs_state      TEXT NOT NULL DEFAULT 'new'
                  CONSTRAINT card_reviews_fsrs_state_check
                  CHECK (fsrs_state IN ('new', 'learning', 'review', 'relearning')),
  hidden_since    TEXT CHECK (hidden_since IS date(hidden_since)),
  seen_in_pasture INTEGER NOT NULL DEFAULT 0 CHECK (seen_in_pasture IN (0, 1)),
  PRIMARY KEY (user_id, card_type, subject_key, locale)
);

-- Regression guard (002, 015, 016, 017, 029). An UPSERT that takes the
-- DO UPDATE path fires UPDATE triggers, as in Postgres.
CREATE TRIGGER card_reviews_reject_regression_trigger
BEFORE UPDATE ON card_reviews
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: last_review cannot transition to NULL')
    WHERE OLD.last_review IS NOT NULL AND NEW.last_review IS NULL;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: first_seen cannot transition to NULL')
    WHERE OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: last_review cannot move backward')
    WHERE OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL
      AND NEW.last_review < OLD.last_review;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: reps cannot decrease')
    WHERE NEW.reps < OLD.reps;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: lapses cannot decrease')
    WHERE NEW.lapses < OLD.lapses;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: scheduled_days cannot drop without advancing last_review')
    WHERE OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL
      AND NEW.last_review = OLD.last_review
      AND NEW.scheduled_days < OLD.scheduled_days;
  SELECT RAISE(ABORT, 'check_violation: card_reviews regression: seen_in_pasture cannot transition from true to false')
    WHERE OLD.seen_in_pasture = 1 AND NEW.seen_in_pasture = 0;
END;

-- updated_at is stamped by the database on every update, whatever the client
-- sent (043). The trigger lists every column except updated_at, so its own
-- UPDATE cannot fire it again, whatever recursive_triggers is set to.
CREATE TRIGGER card_reviews_set_updated_at_trigger
AFTER UPDATE OF id, user_id, card_type, subject_key, locale, due_date, last_review,
  first_seen, stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
  fsrs_state, hidden_since, seen_in_pasture ON card_reviews
FOR EACH ROW
BEGIN
  UPDATE card_reviews
     SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   WHERE user_id = NEW.user_id AND card_type = NEW.card_type
     AND subject_key = NEW.subject_key AND locale = NEW.locale;
END;

-- last_reset_at tombstone (022): a stale device cannot re-insert progress
-- dated before the user's last reset.
CREATE TRIGGER card_reviews_reject_pre_reset_trigger
BEFORE INSERT ON card_reviews
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: card_reviews: cannot INSERT row with first_seen before last_reset_at')
    WHERE NEW.first_seen IS NOT NULL AND NEW.first_seen <
      (SELECT date(last_reset_at) FROM user_settings WHERE user_id = NEW.user_id);
  SELECT RAISE(ABORT, 'check_violation: card_reviews: cannot INSERT row with last_review before last_reset_at')
    WHERE NEW.last_review IS NOT NULL AND NEW.last_review <
      (SELECT date(last_reset_at) FROM user_settings WHERE user_id = NEW.user_id);
END;

-- ── streak_days (001, 021, 022) ─────────────────────────────────────────────
CREATE TABLE streak_days (
  id          TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL CHECK (review_date IS date(review_date)),
  UNIQUE (user_id, review_date)
);

-- 021: CHECK (review_date <= current_date + 1), one grace day for UTC+14.
CREATE TRIGGER streak_days_no_future_date_insert
BEFORE INSERT ON streak_days
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: streak_days_no_future_date')
    WHERE NEW.review_date > date('now', '+1 day');
END;

CREATE TRIGGER streak_days_no_future_date_update
BEFORE UPDATE OF review_date ON streak_days
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: streak_days_no_future_date')
    WHERE NEW.review_date > date('now', '+1 day');
END;

CREATE TRIGGER streak_days_reject_pre_reset_trigger
BEFORE INSERT ON streak_days
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: streak_days: cannot INSERT row with review_date before last_reset_at')
    WHERE NEW.review_date <
      (SELECT date(last_reset_at) FROM user_settings WHERE user_id = NEW.user_id);
END;

-- ── user_settings (001, 003, 005, 019, 022, 030) ────────────────────────────
-- The deep merge and the 038 regression guard run in Worker code (design D3).
CREATE TABLE user_settings (
  user_id                TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  settings               TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  timezone               TEXT,
  date_format            TEXT CHECK (date_format IS NULL OR date_format IN ('iso', 'dmy', 'mdy')),
  last_reset_at          TEXT,
  push_notification_hour INTEGER CHECK (push_notification_hour IS NULL
                           OR (push_notification_hour >= 0 AND push_notification_hour <= 23))
);

-- ── grade_log (006, 009, 013, 029, 033) ─────────────────────────────────────
-- card_type and locale are validated at the app boundary only (013, 029).
CREATE TABLE grade_log (
  id              TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  occurred_at     INTEGER NOT NULL,
  entry_date      TEXT NOT NULL CHECK (entry_date IS date(entry_date)),
  card_type       TEXT NOT NULL,
  grade           INTEGER NOT NULL CHECK (grade IN (1, 2, 4, 5)),
  subject_key     TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en',
  learning_step   INTEGER,
  step_started_at INTEGER,
  UNIQUE (user_id, occurred_at)
);
CREATE INDEX grade_log_user_date ON grade_log (user_id, entry_date DESC);
CREATE INDEX grade_log_user_subject ON grade_log (user_id, card_type, subject_key);

CREATE TRIGGER grade_log_reject_pre_reset_trigger
BEFORE INSERT ON grade_log
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'check_violation: grade_log: cannot INSERT row with entry_date before last_reset_at')
    WHERE NEW.entry_date <
      (SELECT date(last_reset_at) FROM user_settings WHERE user_id = NEW.user_id);
END;

-- ── push_subscriptions (028, 049) ───────────────────────────────────────────
-- Known hosts (049): the same rule as KNOWN_PUSH_ENDPOINT_PATTERN in
-- lib/push/endpoints.ts, written without regex (a test compares the two).
-- Unlike Postgres (NOT VALID) it also applies to copied rows: the data copy
-- skips any row on another host, which the send path ignored anyway.
CREATE TABLE push_subscriptions (
  id           TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth_secret  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, endpoint),
  CONSTRAINT push_subscriptions_endpoint_known_host CHECK (
    endpoint GLOB 'https://?*/*' AND (
      substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1) IN ('fcm.googleapis.com', 'updates.push.services.mozilla.com')
      OR (substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1) GLOB '?*.push.apple.com'
          AND substr(substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1), 1, length(substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1)) - 15) NOT GLOB '*[^a-z0-9.-]*')
      OR (substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1) GLOB '?*.notify.windows.com'
          AND substr(substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1), 1, length(substr(endpoint, 9, instr(substr(endpoint, 9), '/') - 1)) - 19) NOT GLOB '*[^a-z0-9-]*')
    )
  )
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- At most 10 per account (049): before an insert, delete the user's rows
-- beyond the newest 9. A refused insert (CHECK, UNIQUE) rolls the delete back.
-- D1 runs one write at a time, so no lock is needed.
CREATE TRIGGER push_subscriptions_enforce_limit_trigger
BEFORE INSERT ON push_subscriptions
FOR EACH ROW
BEGIN
  DELETE FROM push_subscriptions
   WHERE id IN (
     SELECT id FROM push_subscriptions
      WHERE user_id = NEW.user_id
      ORDER BY last_seen_at DESC, id DESC
      LIMIT -1 OFFSET 9
   );
END;

-- last_seen_at is the database's time at insert, never the client's clock (049).
CREATE TRIGGER push_subscriptions_set_last_seen_trigger
AFTER INSERT ON push_subscriptions
FOR EACH ROW
BEGIN
  UPDATE push_subscriptions SET last_seen_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = NEW.id;
END;

-- ── feedback (034, 039) ─────────────────────────────────────────────────────
-- user_id is null for guest feedback. Retention (12 months) is a cron route.
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id     TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'other')),
  message     TEXT NOT NULL,
  page        TEXT,
  app_version TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX feedback_user ON feedback (user_id) WHERE user_id IS NOT NULL;

-- ── feedback_discord_posts (051) ────────────────────────────────────────────
-- The Discord message posted for a feedback row. No foreign key on purpose: the
-- row must outlive the feedback delete so the delete notify can find the post.
CREATE TABLE feedback_discord_posts (
  feedback_id        TEXT PRIMARY KEY NOT NULL,
  discord_message_id TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── rate_limit_buckets (041, 045) ───────────────────────────────────────────
CREATE TABLE rate_limit_buckets (
  id           TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  ip_hash      TEXT NOT NULL CHECK (length(ip_hash) = 64),
  action       TEXT NOT NULL
               CONSTRAINT rate_limit_buckets_action_check
               CHECK (action IN ('signup', 'signin', 'feedback')),
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_rlb_ip_hash_action_time ON rate_limit_buckets (ip_hash, action, attempted_at DESC);
