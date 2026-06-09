-- Migration 042: feedback Discord notifications (#1653)
--
-- Adds a pg_net AFTER INSERT trigger on `feedback` for bug-category rows
-- (immediate Discord ping) and a pg_cron weekly digest job.
--
-- ARCHITECTURE
-- Two notification paths mirror the push-reminder pattern from migrations
-- 028/031:
--   1. AFTER INSERT trigger on feedback WHERE category = 'bug':
--      Reads the Discord webhook URL from Vault ('discord_notify_url') and
--      the shared bearer ('cron_shared_secret'), then calls pg_net.http_post
--      to POST a JSON body of safe metadata to the Vercel route
--      app/api/discord/notify/route.ts.  The route formats the Discord embed
--      and POSTs to the webhook.
--
--   2. pg_cron weekly job ('0 9 * * 1', Mon 09:00 UTC):
--      Calls pg_net.http_post to app/api/discord/digest/route.ts with a
--      minimal body { "window_days": 7 }.  The route queries the feedback
--      table via the service-role key, aggregates counts by category, and
--      POSTs a weekly digest embed to Discord.
--
-- SAFE FIELDS SENT TO DISCORD (never message, never user_id)
--   category, page, app_version, created_at, authenticated (bool),
--   + feedback.id (row UUID only, used for a maintainer-only Supabase link)
--
-- VAULT SECRETS REQUIRED (set after migration, before first trigger fire)
--   discord_notify_url    - full Vercel URL: https://…/api/discord/notify
--   discord_digest_url    - full Vercel URL: https://…/api/discord/digest
--   cron_shared_secret    - same value as the CRON_SHARED_SECRET Vercel env
--
-- pg_cron / pg_net are Supabase-managed extensions; not available in the
-- stock postgres:15 integration-test container used by CI. Every pg_cron /
-- pg_net call is wrapped in a DO block with an EXCEPTION clause so a missing
-- extension degrades to a NOTICE rather than aborting the migration.
-- The trigger function itself is also wrapped so CI applies cleanly.

-- 1. TRIGGER FUNCTION
-- SECURITY DEFINER so the function can read vault.decrypted_secrets without
-- requiring the invoking user to hold SELECT on vault.*. Wrapped in DO/EXCEPTION
-- so CI's postgres:15 (no pg_net, no vault schema) degrades gracefully.
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION notify_discord_on_bug()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  DECLARE
    v_url       text;
    v_secret    text;
    v_payload   jsonb;
  BEGIN
    -- Read the Vercel route URL and bearer secret from Vault.
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'discord_notify_url'
      LIMIT 1;

    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_shared_secret'
      LIMIT 1;

    -- If either secret is missing, log a notice and skip the HTTP call.
    IF v_url IS NULL OR v_secret IS NULL THEN
      RAISE NOTICE 'notify_discord_on_bug: missing Vault secret(s), skipping HTTP post';
      RETURN NEW;
    END IF;

    -- Build the safe metadata payload.
    -- NEVER include message or user_id - only category, page, app_version,
    -- created_at, authenticated (bool from user_id IS NOT NULL), and the row
    -- uuid id (used by the route to build a maintainer-only deep link).
    v_payload := jsonb_build_object(
      'id',            NEW.id,
      'category',      NEW.category,
      'page',          NEW.page,
      'app_version',   NEW.app_version,
      'created_at',    NEW.created_at,
      'authenticated', (NEW.user_id IS NOT NULL)
    );

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type',  'application/json'
      ),
      body    := v_payload
    );

    RETURN NEW;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'notify_discord_on_bug: http_post failed: %', SQLERRM;
      RETURN NEW;
  END;
  $func$;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping notify_discord_on_bug function creation (pg_net / vault not available): %', SQLERRM;
END;
$$;

-- 2. TRIGGER
-- Fires AFTER INSERT on feedback, only for bug-category rows.
-- Wrapped in DO/EXCEPTION so CI degrades gracefully if the function above
-- was not created.
DO $$
BEGIN
  DROP TRIGGER IF EXISTS discord_notify_on_bug ON feedback;

  CREATE TRIGGER discord_notify_on_bug
    AFTER INSERT ON feedback
    FOR EACH ROW
    WHEN (NEW.category = 'bug')
    EXECUTE FUNCTION notify_discord_on_bug();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping discord_notify_on_bug trigger creation: %', SQLERRM;
END;
$$;

-- 3. DIGEST FUNCTION
-- Extracted as a top-level SECURITY DEFINER function to avoid nested
-- dollar-quote tag collision.  The cron body becomes a simple
-- `SELECT feedback_send_digest();` with no inner $$ quoting required.
-- Wrapped in DO/EXCEPTION so CI's postgres:15 (no pg_net, no vault schema)
-- degrades gracefully -- same pattern as notify_discord_on_bug above.
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION feedback_send_digest()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  DECLARE
    v_url    text;
    v_secret text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'discord_digest_url'
      LIMIT 1;

    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_shared_secret'
      LIMIT 1;

    -- Guard: if either secret is unset, skip the post rather than sending
    -- an empty-bearer request that silently 401s.
    IF v_url IS NULL OR v_secret IS NULL THEN
      RAISE NOTICE 'feedback-discord-digest: missing Vault secret(s), skipping HTTP post';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type',  'application/json'
      ),
      body    := '{"window_days":7}'::jsonb
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'feedback-discord-digest: http_post failed: %', SQLERRM;
  END;
  $func$;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping feedback_send_digest function creation (pg_net / vault not available): %', SQLERRM;
END;
$$;

-- 4. WEEKLY DIGEST CRON JOB
-- Unschedule any existing job first (idempotent re-apply guard).
DO $$
BEGIN
  PERFORM cron.unschedule('feedback-discord-digest');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.unschedule(feedback-discord-digest) (pg_cron not available or job not found): %', SQLERRM;
END;
$$;

-- Schedule weekly Mon 09:00 UTC digest.
-- Cron body is a single SELECT statement -- no nested dollar-quoting.
DO $$
BEGIN
  PERFORM cron.schedule(
    'feedback-discord-digest',
    '0 9 * * 1',
    $cronbody$ SELECT feedback_send_digest(); $cronbody$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping cron.schedule(feedback-discord-digest) (pg_cron not available): %', SQLERRM;
END;
$$;
