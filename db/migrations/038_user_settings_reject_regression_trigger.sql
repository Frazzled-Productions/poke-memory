-- Migration 038: BEFORE UPDATE regression-reject trigger for user_settings.
--
-- Modelled on card_reviews_reject_regression (migration 002 / 015 / 016 / 017).
-- The trigger physically refuses any write that destroys data the user has built
-- up, making it impossible for a stale or buggy client to silently wipe settings.
--
-- Predicates:
--   1. streakProtection.spendDates  — no date may be removed.
--   2. streakProtection.balance     — may only decrease when new spend entries are added
--                                     (i.e. a token was spent); a bare balance drop is rejected.
--   3. earnedBadges                 — no badge id may be removed (id-level check, not length).
--   4. onboarding dismissal flags   — a flag that is true cannot be set to non-true.
--                                     Exception: if NEW.settings.onboardingResetAt is a
--                                     non-null string that is strictly lexicographically >
--                                     OLD.settings.onboardingResetAt (or OLD is absent), the
--                                     user intentionally clicked "Show onboarding again" and
--                                     the revert is allowed. The client sets this tombstone in
--                                     lib/settings/persistence.ts when resetting onboarding.
--   5. Top-level one-shot flags     — typedEntryOnboardingShown, mcCardOnboardingShown:
--                                     same true->non-true check. verifiedTypedEntryMode is
--                                     excluded — it is a toggleable preference, not one-shot.
--                                     These flags are NOT reset by "Show onboarding again" and
--                                     are never bypassed by the onboardingResetAt tombstone.
--   6. onboarding monotonic counters — practiceSessionsCount, slowSpriteLoadCount:
--                                     new value must be >= old value.
--                                     Exception: same onboardingResetAt tombstone as predicate 4.
--   7. learningLocales              — no locale may be removed unless it is present in
--                                     removedLocales (tombstone-safe); defaults to ["en"].
--
-- ERRCODE: 23514 (check_violation) — matches the card_reviews trigger so
-- `isStructuralError` in lib/sync/cloud.ts continues to treat it as a
-- best-effort/warn-and-skip error rather than a structural halt.
--
-- NOTE: the dismissal-flag list in predicate 4 must be kept in sync with
-- `OnboardingFlags` in lib/settings/persistence.ts. A pointer comment in that
-- file marks the sync obligation.

CREATE OR REPLACE FUNCTION public.user_settings_reject_regression()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  old_sp                     jsonb;
  new_sp                     jsonb;
  old_spend                  jsonb;
  new_spend                  jsonb;
  old_bal                    numeric;
  new_bal                    numeric;
  old_badges                 jsonb;
  new_badges                 jsonb;
  old_onb                    jsonb;
  new_onb                    jsonb;
  old_ll                     jsonb;
  new_ll                     jsonb;
  new_removed                jsonb;
  badge_id                   text;
  flag                       text;
  date_val                   text;
  locale_val                 text;
  i                          int;
  old_count                  numeric;
  new_count                  numeric;
  onboarding_intentional_reset bool := false;
BEGIN
  -- ── 1 + 2: streakProtection ────────────────────────────────────────────────
  old_sp := CASE WHEN jsonb_typeof(OLD.settings -> 'streakProtection') = 'object'
                 THEN OLD.settings -> 'streakProtection'
                 ELSE '{}'::jsonb END;
  new_sp := CASE WHEN jsonb_typeof(NEW.settings -> 'streakProtection') = 'object'
                 THEN NEW.settings -> 'streakProtection'
                 ELSE '{}'::jsonb END;

  old_spend := CASE WHEN jsonb_typeof(old_sp -> 'spendDates') = 'array'
                    THEN old_sp -> 'spendDates'
                    ELSE '[]'::jsonb END;
  new_spend := CASE WHEN jsonb_typeof(new_sp -> 'spendDates') = 'array'
                    THEN new_sp -> 'spendDates'
                    ELSE '[]'::jsonb END;

  -- 1: every spend date in OLD must be present in NEW.
  FOR i IN 0 .. jsonb_array_length(old_spend) - 1 LOOP
    date_val := old_spend ->> i;
    IF NOT (new_spend @> to_jsonb(ARRAY[date_val])) THEN
      RAISE EXCEPTION
        'user_settings regression: spendDate % removed from streakProtection', date_val
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- 2: balance may only decrease when new spend dates have been added.
  old_bal := CASE WHEN (old_sp ->> 'balance') IS NOT NULL
                  THEN (old_sp ->> 'balance')::numeric
                  ELSE 0 END;
  new_bal := CASE WHEN (new_sp ->> 'balance') IS NOT NULL
                  THEN (new_sp ->> 'balance')::numeric
                  ELSE 0 END;
  IF new_bal < old_bal AND jsonb_array_length(new_spend) <= jsonb_array_length(old_spend) THEN
    RAISE EXCEPTION
      'user_settings regression: streakProtection.balance dropped (% -> %) without new spendDate',
      old_bal, new_bal
      USING ERRCODE = '23514';
  END IF;

  -- ── 3: earnedBadges ────────────────────────────────────────────────────────
  old_badges := CASE WHEN jsonb_typeof(OLD.settings -> 'earnedBadges') = 'array'
                     THEN OLD.settings -> 'earnedBadges'
                     ELSE '[]'::jsonb END;
  new_badges := CASE WHEN jsonb_typeof(NEW.settings -> 'earnedBadges') = 'array'
                     THEN NEW.settings -> 'earnedBadges'
                     ELSE '[]'::jsonb END;

  FOR i IN 0 .. jsonb_array_length(old_badges) - 1 LOOP
    badge_id := old_badges -> i ->> 'id';
    IF badge_id IS NULL THEN
      CONTINUE;
    END IF;
    -- Check whether any element of new_badges has this id.
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(new_badges) AS elem
      WHERE elem ->> 'id' = badge_id
    ) THEN
      RAISE EXCEPTION
        'user_settings regression: earnedBadge id % removed', badge_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- ── 4: onboarding dismissal flags ─────────────────────────────────────────
  -- Each listed flag is a one-shot dismissal: once true it must stay true.
  -- Exception: if the client includes a strictly-newer onboardingResetAt timestamp
  -- the reset is user-intentional ("Show onboarding again" button) and is allowed.
  -- NOTE: keep this list in sync with OnboardingFlags in lib/settings/persistence.ts.
  old_onb := CASE WHEN jsonb_typeof(OLD.settings -> 'onboarding') = 'object'
                  THEN OLD.settings -> 'onboarding'
                  ELSE '{}'::jsonb END;
  new_onb := CASE WHEN jsonb_typeof(NEW.settings -> 'onboarding') = 'object'
                  THEN NEW.settings -> 'onboarding'
                  ELSE '{}'::jsonb END;

  -- Check for the user-intentional onboarding reset tombstone.
  -- A strictly-newer onboardingResetAt means the user clicked "Show onboarding again";
  -- predicates 4 and 6 are skipped for that write.
  IF (NEW.settings ->> 'onboardingResetAt') IS NOT NULL
     AND (NEW.settings ->> 'onboardingResetAt') > COALESCE(OLD.settings ->> 'onboardingResetAt', '')
  THEN
    onboarding_intentional_reset := true;
  END IF;

  IF NOT onboarding_intentional_reset THEN
    FOR flag IN SELECT unnest(ARRAY[
      'firstVisitOnboardingDismissed',
      'welcomeDismissed',
      'practiceHintDismissed',
      'statsHintDismissed',
      'settingsHintDismissed',
      'installNudgeDismissed',
      'audioHintDismissed',
      'cardTypesHintDismissed',
      'guestStorageNoticeDismissed',
      'journeyMasteryExplainerDismissed',
      'markWhatIKnowNudgeDismissed',
      'practiceScopeNudgeDismissed',
      'scopeEverOpened',
      'offlineDownloadNudgeDismissed',
      'pastureLongPressHintDismissed',
      'higherOrLowerNudgeDismissed',
      'guestSignUpNudgeDismissed'
    ]) LOOP
      IF (old_onb ->> flag)::boolean = true
         AND (new_onb ->> flag)::boolean IS DISTINCT FROM true
      THEN
        RAISE EXCEPTION
          'user_settings regression: onboarding.% was true, cannot be set to non-true', flag
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- ── 5: top-level one-shot flags ───────────────────────────────────────────
  -- typedEntryOnboardingShown and mcCardOnboardingShown: true -> non-true is rejected.
  -- verifiedTypedEntryMode is excluded — it is a toggleable preference.
  -- These top-level flags are NOT reset by "Show onboarding again" and are never
  -- bypassed by the onboardingResetAt tombstone.
  FOR flag IN SELECT unnest(ARRAY[
    'typedEntryOnboardingShown',
    'mcCardOnboardingShown'
  ]) LOOP
    IF (OLD.settings ->> flag)::boolean = true
       AND (NEW.settings ->> flag)::boolean IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION
        'user_settings regression: top-level flag % was true, cannot be set to non-true', flag
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- ── 6: onboarding monotonic counters ──────────────────────────────────────
  -- Same onboardingResetAt tombstone exception as predicate 4: the user-intentional
  -- reset is allowed to zero out the counters so nudge thresholds reset correctly.
  IF NOT onboarding_intentional_reset THEN
    FOR flag IN SELECT unnest(ARRAY[
      'practiceSessionsCount',
      'slowSpriteLoadCount'
    ]) LOOP
      old_count := CASE WHEN (old_onb ->> flag) IS NOT NULL
                        THEN (old_onb ->> flag)::numeric
                        ELSE 0 END;
      new_count := CASE WHEN (new_onb ->> flag) IS NOT NULL
                        THEN (new_onb ->> flag)::numeric
                        ELSE 0 END;
      IF new_count < old_count THEN
        RAISE EXCEPTION
          'user_settings regression: onboarding.% decreased (% -> %)', flag, old_count, new_count
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- ── 7: learningLocales ────────────────────────────────────────────────────
  -- A locale in OLD must be present in NEW.learningLocales OR in NEW.removedLocales
  -- (tombstone: the user explicitly removed it on another device).
  -- Default OLD/NEW learningLocales to '["en"]' when absent.
  old_ll := CASE WHEN jsonb_typeof(OLD.settings -> 'learningLocales') = 'array'
                 THEN OLD.settings -> 'learningLocales'
                 ELSE '["en"]'::jsonb END;
  new_ll := CASE WHEN jsonb_typeof(NEW.settings -> 'learningLocales') = 'array'
                 THEN NEW.settings -> 'learningLocales'
                 ELSE '["en"]'::jsonb END;
  new_removed := CASE WHEN jsonb_typeof(NEW.settings -> 'removedLocales') = 'array'
                      THEN NEW.settings -> 'removedLocales'
                      ELSE '[]'::jsonb END;

  FOR i IN 0 .. jsonb_array_length(old_ll) - 1 LOOP
    locale_val := old_ll ->> i;
    -- Locale must be in new learningLocales OR in new removedLocales.
    IF NOT (new_ll @> to_jsonb(ARRAY[locale_val]))
       AND NOT (new_removed @> to_jsonb(ARRAY[locale_val]))
    THEN
      RAISE EXCEPTION
        'user_settings regression: learningLocale % removed without tombstone in removedLocales',
        locale_val
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END; $$;

-- Drop the trigger if it already exists (idempotent re-run).
DROP TRIGGER IF EXISTS user_settings_reject_regression_trigger
  ON public.user_settings;

CREATE TRIGGER user_settings_reject_regression_trigger
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.user_settings_reject_regression();
