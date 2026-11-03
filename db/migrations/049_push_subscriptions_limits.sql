-- Migration: 049_push_subscriptions_limits (ops #380, change harden-push-delivery)
--
-- Two limits on push_subscriptions, on top of the checks in the app:
--
-- KNOWN HOSTS
-- The database constraint is the rule. The pattern repeats
-- KNOWN_PUSH_ENDPOINT_PATTERN in lib/push/endpoints.ts; the "One list" test
-- fails if they differ. NOT VALID
-- leaves existing rows alone (the send path skips any on another host) and
-- checks new ones. VALIDATE CONSTRAINT is a follow-up, after a count of rows by
-- host. An UPDATE to an old row would be refused; nothing updates this table.
--
-- AT MOST 10 PER ACCOUNT
-- A BEFORE INSERT trigger makes room by deleting the user's rows beyond the
-- newest 9, so an account already over the limit comes down to 10. The advisory
-- lock serialises inserts per user: without it parallel inserts each count the
-- rows before the others commit. The function runs as the caller, so the delete
-- stays inside RLS: an insert for another user removes nothing and then fails
-- its WITH CHECK. A refused insert rolls the trigger's delete back.
-- last_seen_at is only written at insert, so "oldest" means least recently
-- subscribed. The trigger sets it to the database's time, because clients send
-- their own clock and a wrong one would otherwise decide which row goes.
-- Callers delete the matching row first, so re-subscribing a device never
-- replaces another.
--
-- Rows from before this migration carry the client's clock. One dated in the
-- future would never be the oldest, so it is brought back to now first (before
-- the constraint, which would refuse an UPDATE to a row on another host).

UPDATE public.push_subscriptions
  SET last_seen_at = pg_catalog.now()
  WHERE last_seen_at > pg_catalog.now();

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_known_host
  CHECK (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/')
  NOT VALID;

CREATE FUNCTION public.push_subscriptions_enforce_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.user_id::text, 0));

  DELETE FROM public.push_subscriptions
  WHERE id IN (
    SELECT id
    FROM public.push_subscriptions
    WHERE user_id = NEW.user_id
    ORDER BY last_seen_at DESC, id DESC
    OFFSET 9
  );

  NEW.last_seen_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER push_subscriptions_enforce_limit_trigger
  BEFORE INSERT ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.push_subscriptions_enforce_limit();
