-- Migration: 046_get_push_targets (#1100)
--
-- Narrows the Web Push send-daily route's cross-user read surface from
-- "service-role key can SELECT anything" to two SECURITY DEFINER functions
-- with explicit, minimal return contracts. The route (app/api/push/send-daily/
-- route.ts) still authenticates its caller via the CRON_SHARED_SECRET Bearer
-- gate and still calls with the service-role client (the simpler of the two
-- auth options in #1100 - no Vault-secret comparison inside the function),
-- but its reads now flow through these functions instead of raw table
-- SELECTs, so a future route bug cannot escape the functions' contract.
--
-- WHY TWO FUNCTIONS, NOT THE SINGLE (user_id, endpoint, p256dh, auth_secret,
-- timezone, due_count) SHAPE THE ISSUE SKETCHED
-- The route has grown since #1100 was filed: due counts are per-locale
-- (#1480/#1504), gated per-user by card-type flags, alt-forms, and practice
-- scope (#1153/#1159), and delivery is gated by push_notification_hour
-- (#1315). The eligibility logic depends on TypeScript-side lookup tables
-- (SCOPE_LOOKUP, the alt-form id rule) that cannot reasonably be ported to
-- SQL, so `due_count` cannot be computed here. Instead the functions return
-- the raw rows the route consumes today and the aggregation stays in the
-- route, exactly as before:
--
--   get_push_targets()                        - one row per push subscription,
--                                               joined to the owner's settings
--                                               (steps 1-2 of the route).
--   get_push_due_cards(user_ids, today_input) - the due card_reviews rows for
--                                               one timezone bucket (step 4).
--
-- The route's only remaining direct table access is the dead-endpoint DELETE
-- on push_subscriptions (410/404 cleanup), which is already narrow.
--
-- SECURITY MODEL
--   - SECURITY DEFINER with SET search_path = '' (migration 018/023 house
--     style); every relation is schema-qualified.
--   - EXECUTE revoked from PUBLIC, anon, and authenticated: these functions
--     read across every user's rows, so no client-reachable role may call
--     them. Granted to service_role only - the route's admin client.
--   - STABLE: read-only, safe for PostgREST to call via GET or POST.

-- ── get_push_targets ─────────────────────────────────────────────────────────
-- One row per push subscription, LEFT JOINed to the owning user's settings
-- row. Users without a user_settings row still receive pushes (the route
-- falls back to default eligibility / UTC / no preferred hour), so the join
-- must be LEFT, not INNER.
CREATE OR REPLACE FUNCTION public.get_push_targets()
RETURNS TABLE (
  subscription_id        uuid,
  user_id                uuid,
  endpoint               text,
  p256dh                 text,
  auth_secret            text,
  timezone               text,
  settings               jsonb,
  push_notification_hour smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
  SELECT
    ps.id,
    ps.user_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth_secret,
    us.timezone,
    us.settings,
    us.push_notification_hour
  FROM public.push_subscriptions ps
  LEFT JOIN public.user_settings us ON us.user_id = ps.user_id
  ORDER BY ps.user_id, ps.id;
$func$;

-- ── get_push_due_cards ───────────────────────────────────────────────────────
-- The due card_reviews rows for one timezone bucket: every non-hidden row for
-- the given users whose due_date is on or before that bucket's "today".
-- Per-user eligibility (card-type flags, alt-forms, practice scope, locale
-- membership) is applied by the route in TypeScript, as before.
--
-- due_date is included in the return shape so the route can keep the stable
-- (user_id, due_date) ORDER BY it already uses for offset pagination via
-- PostgREST .range() - fetchAllPages needs a total order that does not shift
-- between pages. The ordering itself is the caller's job (PostgREST applies
-- the route's .order() around the function call), so the body carries no
-- ORDER BY of its own.
CREATE OR REPLACE FUNCTION public.get_push_due_cards(
  user_ids    uuid[],
  today_input date
)
RETURNS TABLE (
  user_id     uuid,
  card_type   text,
  subject_key text,
  first_seen  date,
  locale      text,
  due_date    date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
  SELECT
    cr.user_id,
    cr.card_type,
    cr.subject_key,
    cr.first_seen,
    cr.locale,
    cr.due_date
  FROM public.card_reviews cr
  WHERE cr.due_date <= today_input
    AND cr.user_id = ANY (user_ids)
    AND cr.hidden_since IS NULL;
$func$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Functions default to EXECUTE for PUBLIC; strip that, then grant only the
-- service_role the route's admin client uses. anon/authenticated are revoked
-- explicitly for clarity even though removing PUBLIC already excludes them.
REVOKE EXECUTE ON FUNCTION public.get_push_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_targets() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_push_due_cards(uuid[], date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_due_cards(uuid[], date) TO service_role;
