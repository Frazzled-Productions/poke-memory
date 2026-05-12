-- Migration: 006_grade_log
--
-- Cross-device sync for the per-grade history that lib/gradelog stores in
-- localStorage. Feeds analytics (heatmap, rolling accuracy, type-mastery
-- breakdown) and survives logout / new device.
--
-- One row per grade event. `occurred_at` (epoch ms — matches the local
-- shape) is the dedup key. `entry_date` is denormalized for fast group-by-
-- day queries.

CREATE TABLE grade_log (
  id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at bigint   NOT NULL,
  entry_date  date     NOT NULL,
  card_type   text     NOT NULL CHECK (card_type IN ('name', 'evolution', 'reverse')),
  grade       smallint NOT NULL CHECK (grade IN (1, 2, 4, 5)),
  UNIQUE (user_id, occurred_at)
);

CREATE INDEX grade_log_user_date ON grade_log (user_id, entry_date DESC);

ALTER TABLE grade_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grade_log_select" ON grade_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "grade_log_insert" ON grade_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "grade_log_update" ON grade_log
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "grade_log_delete" ON grade_log
  FOR DELETE USING (auth.uid() = user_id);
