-- Migration: 028_web_push_subscriptions
--
-- Web Push daily review reminders for the installed iOS PWA (#1056).
--
-- ARCHITECTURE — hybrid pg_cron + Vercel route
-- We need a daily push that fans out per-user "you have N cards due" Web
-- Push notifications. The signing path requires ECDSA P-256 (ES256) JWTs
-- per the VAPID spec, which pgcrypto cannot produce and pgsodium can only
-- produce as EdDSA — neither matches what browsers accept. So pg_cron
-- handles the schedule only, and the Vercel route handler at
-- app/api/push/send-daily/route.ts handles the actual encryption + send
-- via the `web-push` npm package. This keeps everything in one codebase:
-- same TypeScript, same deploy, same env vars, same tests.
--
-- FLOW
-- 1. pg_cron fires daily at 08:00 UTC and calls net.http_post against the
--    Vercel route, reading both the URL and the shared secret from
--    vault.secrets so production and preview can differ without code changes.
-- 2. The route verifies the Bearer secret, queries every push_subscription
--    joined to user_settings.timezone and today's due-card count, and
--    sends a Web Push for each user with due_count > 0.
-- 3. On a 410/404 from a subscription endpoint, the route deletes that row.
--
-- TABLE — push_subscriptions
-- One row per (user, browser/device endpoint). Per docs/persistence.md this
-- is a new "monotonic / per-event" table: rows are created on subscribe,
-- deleted on unsubscribe (or on dead-endpoint cleanup), never mutated.
-- last_seen_at is a soft cleanup hint, not an invariant.
--
-- RLS
-- SELECT, INSERT, and DELETE policies scoped to (SELECT auth.uid()) per the
-- migration 024 init-plan pattern. No UPDATE policy — the only mutation is
-- last_seen_at, which the server-side route handler updates via the service
-- role key (bypasses RLS).
--
-- MANUAL SETUP REQUIRED AFTER MERGE
--   1. Generate a VAPID keypair:
--        npx web-push generate-vapid-keys
--      This prints `Public Key:` and `Private Key:` (base64url-encoded).
--
--   2. Set these env vars in Vercel (Production + Preview, server-side
--      unless prefixed `NEXT_PUBLIC_`):
--        NEXT_PUBLIC_VAPID_PUBLIC_KEY   — public key from step 1
--        VAPID_PRIVATE_KEY              — private key from step 1
--        VAPID_SUBJECT                  — mailto: contact, e.g.
--                                         mailto:hello@pokememory.com
--        CRON_SHARED_SECRET             — `openssl rand -base64 32`
--        SUPABASE_SERVICE_ROLE_KEY      — already set; the route needs it
--                                         for the cross-user query.
--
--   3. Populate Supabase Vault with the cron URL + shared secret so this
--      migration's cron command can reach the Vercel route:
--        INSERT INTO vault.secrets (name, secret) VALUES
--          ('push_send_url',      'https://pokememory.com/api/push/send-daily'),
--          ('cron_shared_secret', '<same value as CRON_SHARED_SECRET above>');
--      Both values must match exactly between Vault and Vercel env or the
--      route will 401 every cron invocation.
--
--   4. After step 3, this migration's pg_cron job will start firing daily
--      at 08:00 UTC. Until step 3 is complete the job runs but fails with
--      a NULL URL / NULL bearer — harmless, but visible in cron.job_run_details.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL,
  p256dh       text        NOT NULL,
  -- The Web Push spec calls this `auth`, but PostgreSQL reserves that word
  -- for the GRANT/REVOKE family. Storing as `auth_secret` so we never need
  -- to quote it; the client/server layers translate at the boundary.
  auth_secret  text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Init-plan pattern from migration 024: (SELECT auth.uid()) is evaluated
-- once per statement instead of once per row.
CREATE POLICY "push_subscriptions_select" ON push_subscriptions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "push_subscriptions_insert" ON push_subscriptions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "push_subscriptions_delete" ON push_subscriptions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- No UPDATE policy on purpose. Subscriptions are append-only from the
-- client's perspective: re-subscribing inserts a new row (or upserts on
-- the (user_id, endpoint) unique key) rather than mutating an existing one.
-- The send-daily route uses the service-role key, which bypasses RLS, to
-- bump last_seen_at and to delete dead endpoints.

-- pg_cron schedule. Reads the URL + shared secret from Vault on every fire,
-- so rotating either value requires only an UPDATE on vault.secrets — no
-- code change. The `headers` JSONB attaches the bearer token; the route
-- handler rejects any caller that does not match.
SELECT cron.schedule(
  'web-push-daily-reminders',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_send_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
