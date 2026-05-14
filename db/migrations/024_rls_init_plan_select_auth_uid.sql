-- Migration: 024_rls_init_plan_select_auth_uid
--
-- Supabase advisor lint 0003 (auth_rls_initplan):
-- Every RLS policy on card_reviews, streak_days, user_settings, and grade_log
-- called auth.uid() directly. PostgREST re-evaluates that for every row
-- inspected, producing suboptimal query plans at scale.
--
-- Replacing `auth.uid()` with `(select auth.uid())` makes Postgres treat the
-- result as a stable initialisation-time scalar, evaluating it once per query
-- instead of once per row. No semantic change.
--
-- 12 policies rewritten:
--   card_reviews_{select, insert, update, delete}
--   streak_days_{select, insert}
--   user_settings_{select, insert, update, delete}
--   grade_log_{select, insert}

-- ─── card_reviews ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "card_reviews_select" ON card_reviews;
CREATE POLICY "card_reviews_select" ON card_reviews
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "card_reviews_insert" ON card_reviews;
CREATE POLICY "card_reviews_insert" ON card_reviews
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "card_reviews_update" ON card_reviews;
CREATE POLICY "card_reviews_update" ON card_reviews
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "card_reviews_delete" ON card_reviews;
CREATE POLICY "card_reviews_delete" ON card_reviews
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ─── streak_days ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "streak_days_select" ON streak_days;
CREATE POLICY "streak_days_select" ON streak_days
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "streak_days_insert" ON streak_days;
CREATE POLICY "streak_days_insert" ON streak_days
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─── user_settings ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_settings_select" ON user_settings;
CREATE POLICY "user_settings_select" ON user_settings
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_settings_insert" ON user_settings;
CREATE POLICY "user_settings_insert" ON user_settings
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_settings_update" ON user_settings;
CREATE POLICY "user_settings_update" ON user_settings
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_settings_delete" ON user_settings;
CREATE POLICY "user_settings_delete" ON user_settings
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ─── grade_log ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "grade_log_select" ON grade_log;
CREATE POLICY "grade_log_select" ON grade_log
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "grade_log_insert" ON grade_log;
CREATE POLICY "grade_log_insert" ON grade_log
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
