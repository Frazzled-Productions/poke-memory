-- Migration: 032_reconcile_grade_log_orphans
-- Issue: #1360
--
-- WHY THIS EXISTS
-- ---------------
-- After the #1344 silent sync outage, recovery depended entirely on each
-- client pushing its local state back to Supabase. This migration adds a
-- standing server-side safety net: a scheduled function that finds
-- "orphaned" subjects (grade_log entries showing graduation with no
-- corresponding card_reviews row) and heals them by inserting a
-- conservative placeholder row.
--
-- WHY CONSERVATIVE (placeholder, not FSRS-replay)
-- -------------------------------------------------
-- A replay-correct heal would require in-memory `learningStep` /
-- `stepStartedAt` state that is never written to grade_log — the FSRS
-- scheduler (lib/srs/scheduler.ts) holds it ephemerally. Without those
-- values, re-deriving FSRS stability/difficulty from raw grades is
-- unreliable. Instead, this function inserts a PLACEHOLDER row that:
--   - Uses safe constant defaults for FSRS fields (stability=1.0,
--     difficulty=5.0).
--   - Sets due_date=CURRENT_DATE so the card is immediately due and the
--     next real client review can overwrite the row with correct state.
--   - Derives reps/lapses/first_seen/last_review from grade_log aggregates
--     (imprecise but always safe: reps is capped by the trigger's
--     monotonic-increase constraint; a real review only ever increases it).
--   - Uses ON CONFLICT DO NOTHING so the regression trigger (migration 002,
--     extended in 015/016/017/029) is never exercised -- a genuine INSERT
--     cannot fire the BEFORE UPDATE trigger.
--
-- REPLAY-CORRECT HEAL DEFERRED
-- -----------------------------
-- A full FSRS-correct replay (using per-user weights, replaying the exact
-- grade sequence through lib/srs/scheduler.ts in a background worker) is
-- deferred to issue #1416. That path is a separate, more complex piece of
-- work that does not block this safety-net landing.
--
-- DRY-RUN ROLLOUT PLAN
-- ---------------------
-- This function ships with p_dry_run DEFAULT true. The pg_cron schedule
-- (also installed here) calls it in dry-run mode for an initial observation
-- period of approximately two weeks. During that time, check Supabase logs
-- for the RAISE NOTICE output to verify orphan counts and confirm the logic
-- is correct before flipping live.
--
-- LIVE ACTIVATION (DEFERRED MANUAL STEP)
-- ----------------------------------------
-- After the observation period, flip the cron schedule from dry-run to live:
--
--   SELECT cron.unschedule('reconcile-grade-log-orphans');
--   SELECT cron.schedule(
--     'reconcile-grade-log-orphans',
--     '0 4 * * 0',
--     $$ SELECT public.reconcile_grade_log_orphans(p_dry_run := false); $$
--   );
--
-- NO-PITR CAUTION (#298)
-- -----------------------
-- Supabase PITR is not yet enabled on this project. Until it is, every
-- production INSERT is effectively one-way -- there is no automated
-- point-in-time rollback. The conservative placeholder design (immediately
-- due, minimal FSRS state) minimises risk: the worst outcome of an erroneous
-- insert is a card appearing as due when the client next syncs, which the
-- client immediately overwrites with correct FSRS state. The ON CONFLICT DO
-- NOTHING guard prevents any existing row from being mutated.
--
-- CARD-TYPE NORMALISATION
-- ------------------------
-- grade_log card_type values use legacy keys retained from earlier migrations:
-- 'evolution' maps to 'evolution-edge' in card_reviews, and
-- 'reverse-evolution' maps to 'reverse-evolution-edge'. The normalisation
-- CTE handles this mapping so the JOIN and INSERT use the canonical
-- card_reviews keys.
--
-- VOLUME CAP
-- -----------
-- LIMIT 50 per run prevents a single cron execution from inserting a large
-- number of rows in the event of a widespread divergence event. The weekly
-- schedule means any backlog is worked off gradually without DB pressure.

CREATE OR REPLACE FUNCTION public.reconcile_grade_log_orphans(
  p_dry_run boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orphan_count integer;
BEGIN
  -- ── Orphan detection CTE ─────────────────────────────────────────────────
  --
  -- An "orphan" is a (user_id, card_type, subject_key, locale) tuple that:
  --   1. Has at least one grade >= 4 (Good or Easy) within the past 4 days,
  --      indicating the user has successfully reviewed the card.
  --   2. Has no corresponding row in card_reviews (the sync row is missing).
  --
  -- card_type is normalised from the legacy grade_log keys to the
  -- card_reviews canonical keys before the LEFT JOIN and INSERT.
  --
  -- The 4-day window balances catching recent divergences against generating
  -- noise from very old grade_log entries that may have intentionally been
  -- superseded by a later reset.

  -- NOTE: this orphan-selection CTE is duplicated in the dry-run COUNT branch
  -- and the live INSERT branch below. They MUST stay identical, or the dry-run
  -- count diverges from what the live run heals. Keep both in sync.
  WITH normalised AS (
    SELECT
      user_id,
      CASE card_type
        WHEN 'evolution'         THEN 'evolution-edge'
        WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
        ELSE card_type
      END AS card_type_normalised,
      subject_key,
      locale,
      grade,
      entry_date
    FROM public.grade_log
    WHERE entry_date >= CURRENT_DATE - INTERVAL '4 days'
  ),
  candidates AS (
    SELECT
      n.user_id,
      n.card_type_normalised                            AS card_type,
      n.subject_key,
      n.locale,
      MIN(n.entry_date)                                 AS first_seen,
      MAX(n.entry_date) FILTER (WHERE n.grade >= 4)     AS last_review,
      COUNT(*) FILTER (WHERE n.grade >= 4)              AS reps,
      -- lapses: Again (grade=1) grades that occurred after the first graduation.
      (
        SELECT COUNT(*)
        FROM normalised n2
        WHERE n2.user_id             = n.user_id
          AND n2.card_type_normalised = n.card_type_normalised
          AND n2.subject_key         = n.subject_key
          AND n2.locale              = n.locale
          AND n2.grade               = 1
          AND n2.entry_date          > (
                SELECT MIN(n3.entry_date)
                FROM normalised n3
                WHERE n3.user_id             = n.user_id
                  AND n3.card_type_normalised = n.card_type_normalised
                  AND n3.subject_key         = n.subject_key
                  AND n3.locale              = n.locale
                  AND n3.grade               >= 4
              )
      )                                                 AS lapses
    FROM normalised n
    GROUP BY n.user_id, n.card_type_normalised, n.subject_key, n.locale
    HAVING MAX(n.grade) >= 4
  ),
  orphans AS (
    SELECT c.*
    FROM candidates c
    LEFT JOIN public.card_reviews cr
           ON cr.user_id     = c.user_id
          AND cr.card_type   = c.card_type
          AND cr.subject_key = c.subject_key
          AND cr.locale      = c.locale
    WHERE cr.user_id IS NULL
    LIMIT 50
  )
  SELECT COUNT(*) INTO v_orphan_count FROM orphans;

  IF p_dry_run THEN
    -- Dry-run: report count only, no writes.
    RAISE NOTICE 'reconcile dry-run: % orphan row(s) would be inserted', v_orphan_count;
    RETURN;
  END IF;

  -- ── Live run: INSERT placeholder rows ────────────────────────────────────
  --
  -- ON CONFLICT DO NOTHING is trigger-safe: the regression trigger fires
  -- only on UPDATE; a conflicting INSERT is silently discarded.
  --
  -- FSRS field defaults:
  --   stability      = 1.0          conservative; real review will recalculate
  --   difficulty     = 5.0          mid-range default; real review recalculates
  --   elapsed_days   = 0            unknown without scheduler state
  --   scheduled_days = 1            minimal interval; card is immediately due
  --   fsrs_state     = 'review'     the card has been graduated at least once
  --   due_date       = CURRENT_DATE immediately due so client re-schedules
  --   seen_in_pasture = false       do not pre-acknowledge pasture visit
  --   hidden_since    = NULL

  -- NOTE: this orphan-selection CTE is duplicated in the dry-run COUNT branch
  -- and the live INSERT branch below. They MUST stay identical, or the dry-run
  -- count diverges from what the live run heals. Keep both in sync.
  WITH normalised AS (
    SELECT
      user_id,
      CASE card_type
        WHEN 'evolution'         THEN 'evolution-edge'
        WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
        ELSE card_type
      END AS card_type_normalised,
      subject_key,
      locale,
      grade,
      entry_date
    FROM public.grade_log
    WHERE entry_date >= CURRENT_DATE - INTERVAL '4 days'
  ),
  candidates AS (
    SELECT
      n.user_id,
      n.card_type_normalised                            AS card_type,
      n.subject_key,
      n.locale,
      MIN(n.entry_date)                                 AS first_seen,
      MAX(n.entry_date) FILTER (WHERE n.grade >= 4)     AS last_review,
      COUNT(*) FILTER (WHERE n.grade >= 4)              AS reps,
      (
        SELECT COUNT(*)
        FROM normalised n2
        WHERE n2.user_id             = n.user_id
          AND n2.card_type_normalised = n.card_type_normalised
          AND n2.subject_key         = n.subject_key
          AND n2.locale              = n.locale
          AND n2.grade               = 1
          AND n2.entry_date          > (
                SELECT MIN(n3.entry_date)
                FROM normalised n3
                WHERE n3.user_id             = n.user_id
                  AND n3.card_type_normalised = n.card_type_normalised
                  AND n3.subject_key         = n.subject_key
                  AND n3.locale              = n.locale
                  AND n3.grade               >= 4
              )
      )                                                 AS lapses
    FROM normalised n
    GROUP BY n.user_id, n.card_type_normalised, n.subject_key, n.locale
    HAVING MAX(n.grade) >= 4
  ),
  orphans AS (
    SELECT c.*
    FROM candidates c
    LEFT JOIN public.card_reviews cr
           ON cr.user_id     = c.user_id
          AND cr.card_type   = c.card_type
          AND cr.subject_key = c.subject_key
          AND cr.locale      = c.locale
    WHERE cr.user_id IS NULL
    LIMIT 50
  ),
  inserted AS (
    INSERT INTO public.card_reviews (
      user_id,
      card_type,
      subject_key,
      locale,
      stability,
      difficulty,
      elapsed_days,
      scheduled_days,
      reps,
      lapses,
      fsrs_state,
      due_date,
      last_review,
      first_seen,
      seen_in_pasture,
      hidden_since,
      updated_at
    )
    SELECT
      o.user_id,
      o.card_type,
      o.subject_key,
      o.locale,
      1.0,                              -- stability: conservative placeholder
      5.0,                              -- difficulty: mid-range placeholder
      0,                                -- elapsed_days: unknown
      1,                                -- scheduled_days: minimal; due immediately
      o.reps::integer,
      o.lapses::integer,
      'review',                         -- fsrs_state: graduated at least once
      CURRENT_DATE,                     -- due_date: immediately due
      o.last_review,
      o.first_seen,
      false,                            -- seen_in_pasture
      NULL,                             -- hidden_since
      now()                             -- updated_at
    FROM orphans o
    ON CONFLICT (user_id, card_type, subject_key, locale) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_orphan_count FROM inserted;

  RAISE NOTICE 'reconcile live: % orphan row(s) inserted', v_orphan_count;
END;
$$;

-- Restrict execution to the service role / pg_cron user only.
-- Public and anon callers must not be able to trigger this function.
REVOKE EXECUTE ON FUNCTION public.reconcile_grade_log_orphans(boolean) FROM public, anon;

-- ── pg_cron schedule ─────────────────────────────────────────────────────────
--
-- Runs weekly on Sunday at 04:00 UTC in DRY-RUN mode.
-- See the header comment for the manual live-activation steps after the
-- observation period (~2 weeks).
--
-- Wrapped in a DO block with an EXCEPTION clause so that a CI environment
-- without pg_cron (the stock postgres:15 integration test container)
-- degrades to a RAISE NOTICE rather than aborting the migration apply.

DO $do$
BEGIN
  PERFORM cron.schedule(
    'reconcile-grade-log-orphans',
    '0 4 * * 0',
    $$ SELECT public.reconcile_grade_log_orphans(p_dry_run := true); $$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.schedule (pg_cron not available): %', SQLERRM;
END
$do$;
