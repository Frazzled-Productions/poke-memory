-- Migration: 025_revoke_rls_auto_enable_execute
--
-- Supabase advisor lints 0028 + 0029 flagged `public.rls_auto_enable()` as a
-- SECURITY DEFINER function callable by `anon` and `authenticated` via
-- `/rest/v1/rpc/rls_auto_enable`. The function exists as a DDL event-trigger
-- helper that auto-enables RLS on newly-created tables; in this project no
-- event trigger currently uses it (it's leftover from the original setup),
-- and crucially it operates on `pg_event_trigger_ddl_commands()` which
-- returns nothing outside an event-trigger context — so calling it via REST
-- is a no-op today.
--
-- It's still unnecessary attack surface. REVOKE EXECUTE from public, anon,
-- and authenticated, leaving the function callable only by roles with
-- explicit grants (e.g. postgres, in case a future event trigger is wired up).

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
