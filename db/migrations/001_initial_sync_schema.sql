-- Migration: 001_initial_sync_schema
-- Creates the three tables required for multi-device session sync.

-- card_reviews: persists SM-2 state per (user, pokemon)
CREATE TABLE IF NOT EXISTS card_reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Standard Pokémon: pokemon_id = Pokédex number (1–1025)
  -- Evolution cards:  pokemon_id = EVOLUTION_ID_OFFSET + pokédex_number (≥ 1_000_001)
  pokemon_id  integer     NOT NULL,
  repetitions integer     NOT NULL DEFAULT 0,
  interval    integer     NOT NULL DEFAULT 0,
  ease_factor numeric(5,4) NOT NULL DEFAULT 2.5,
  due_date    date        NOT NULL,
  last_review date,
  first_seen  date,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pokemon_id)
);

ALTER TABLE card_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_reviews_select" ON card_reviews
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "card_reviews_insert" ON card_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "card_reviews_update" ON card_reviews
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "card_reviews_delete" ON card_reviews
  FOR DELETE USING (auth.uid() = user_id);

-- streak_days: schema scaffolding only — no read/write paths exist yet.
-- Deferred to the streak-tracking feature.
CREATE TABLE IF NOT EXISTS streak_days (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_date date  NOT NULL,
  UNIQUE (user_id, review_date)
);

ALTER TABLE streak_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "streak_days_select" ON streak_days
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "streak_days_insert" ON streak_days
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "streak_days_update" ON streak_days
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "streak_days_delete" ON streak_days
  FOR DELETE USING (auth.uid() = user_id);

-- user_settings: schema scaffolding only — no read/write paths exist yet.
-- Deferred to the settings/daily-limit-override feature.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id             uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  max_new_per_day     integer NOT NULL DEFAULT 10,
  max_reviews_per_day integer NOT NULL DEFAULT 100,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_select" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_settings_delete" ON user_settings
  FOR DELETE USING (auth.uid() = user_id);
