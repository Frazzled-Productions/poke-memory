-- Migration: 039_index_hygiene
--
-- Index hygiene from a Supabase advisor pass (#1798). Two changes, both on
-- currently-empty tables, so this is zero-risk future-proofing rather than a
-- live latency fix.
--
-- 1. ADD a covering index on feedback.user_id.
--    The FK feedback_user_id_fkey (ON DELETE CASCADE to auth.users, migration
--    034) has no covering index, so deleting a user seq-scans feedback to find
--    cascade targets. user_id is nullable (anonymous feedback rows have
--    user_id = NULL, see 034), and the cascade only ever matches non-null
--    rows, so a partial index WHERE user_id IS NOT NULL covers the cascade
--    lookup while staying smaller.
--
-- 2. DROP the redundant idx_usernames_user_id.
--    Migration 035 created both `one_username_per_user UNIQUE (user_id)` and a
--    plain `idx_usernames_user_id` on the same column. The UNIQUE constraint's
--    backing index already covers every (user_id) lookup, so the plain index
--    is dead weight. Dropping it leaves user_id indexed via the constraint;
--    the UNIQUE index cannot itself be dropped.
--
-- DECLINED (recorded so future advisor runs are not re-actioned):
--   * grade_log (entry_date): already covered by the composite
--     grade_log_user_date (user_id, entry_date DESC); every query is user-scoped
--     by RLS, so a standalone (entry_date) index would never be chosen.
--   * card_reviews (user_id): the PK card_reviews_pkey is leading-user_id
--     (user_id, card_type, subject_key, locale), so WHERE user_id = $1 is
--     already served; a standalone index would be strictly redundant.

-- IF NOT EXISTS: intentional divergence from house style (bare CREATE INDEX per #1798 Notes);
-- guards against re-run on partial failure without changing the net schema state.
CREATE INDEX IF NOT EXISTS feedback_user ON public.feedback (user_id) WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_usernames_user_id;
