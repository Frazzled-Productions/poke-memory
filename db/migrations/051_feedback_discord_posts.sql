-- Migration 051: delete the Discord bug notification with its feedback (ops #405)
--
-- Since #1848 the bug notification in the maintainer's Discord channel holds a
-- capped preview of the message. The feedback row is deleted by the 12-month
-- purge (034) or the account cascade (034, user_id ON DELETE CASCADE), but the
-- Discord post was not. This migration lets the post go with the row:
--
--   1. `feedback_discord_posts` maps a feedback id to the Discord message id.
--      The notify route (app/api/discord/notify/route.ts) posts with
--      `?wait=true` and stores the id Discord returns. There is deliberately no
--      foreign key to `feedback`: the mapping must outlive the row until the
--      Discord post is gone. It holds no user_id and no message text.
--
--   2. An AFTER DELETE trigger on `feedback` sends { event: "deleted", id } to
--      the same notify route, with the same Vault secrets as 042
--      ('discord_notify_url', 'cron_shared_secret'), so no new secret is needed.
--      The route deletes the Discord message, then the mapping row. The trigger
--      fires once per deleted row, for the purge and the cascade alike, and
--      only where a mapping exists.
--
-- pg_net and Vault are Supabase-managed and absent from CI's stock postgres:15,
-- so the trigger function and trigger are wrapped in DO/EXCEPTION blocks, as in
-- 042. A failed post never blocks the delete.

-- 1. MAPPING TABLE
CREATE TABLE IF NOT EXISTS feedback_discord_posts (
  feedback_id        uuid        PRIMARY KEY,
  discord_message_id text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Service-role only, like `feedback` (040): RLS on and a deny-all SELECT policy.
ALTER TABLE feedback_discord_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_discord_posts_no_client_select" ON public.feedback_discord_posts;
CREATE POLICY "feedback_discord_posts_no_client_select"
  ON public.feedback_discord_posts FOR SELECT USING (false);

-- 2. TRIGGER FUNCTION
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION notify_discord_on_feedback_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  DECLARE
    v_url    text;
    v_secret text;
  BEGIN
    -- Nothing was posted for this row (or it is already gone): no call.
    IF NOT EXISTS (
      SELECT 1 FROM feedback_discord_posts WHERE feedback_id = OLD.id
    ) THEN
      RETURN OLD;
    END IF;

    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'discord_notify_url'
      LIMIT 1;

    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_shared_secret'
      LIMIT 1;

    IF v_url IS NULL OR v_secret IS NULL THEN
      RAISE NOTICE 'notify_discord_on_feedback_delete: missing Vault secret(s), skipping HTTP post';
      RETURN OLD;
    END IF;

    -- Only the row id: never message, never user_id.
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('event', 'deleted', 'id', OLD.id)
    );

    RETURN OLD;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'notify_discord_on_feedback_delete: http_post failed: %', SQLERRM;
      RETURN OLD;
  END;
  $func$;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping notify_discord_on_feedback_delete function creation (pg_net / vault not available): %', SQLERRM;
END;
$$;

-- 3. TRIGGER
DO $$
BEGIN
  DROP TRIGGER IF EXISTS discord_delete_on_feedback_delete ON feedback;

  CREATE TRIGGER discord_delete_on_feedback_delete
    AFTER DELETE ON feedback
    FOR EACH ROW
    WHEN (OLD.category = 'bug')
    EXECUTE FUNCTION notify_discord_on_feedback_delete();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping discord_delete_on_feedback_delete trigger creation: %', SQLERRM;
END;
$$;
