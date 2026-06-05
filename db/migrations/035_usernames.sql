-- Migration 035: public.usernames table for username/password sign-in.
--
-- Supabase Auth only supports email or phone as the login identifier. To allow
-- a username-based login without requiring an email address, we store a
-- deterministic synthetic email in auth.users and map it back to the username
-- here. The usernames table is the canonical store of the username -> user_id
-- mapping.
--
-- Security notes:
--   - SELECT is intentionally open: a "username taken?" check at sign-up must
--     work before the session is created. Username enumeration is an accepted
--     trade-off and is documented in the PR body (#1671).
--   - INSERT is owner-only: only the authenticated user whose user_id matches
--     auth.uid() may insert.
--   - No UPDATE / DELETE policy: usernames are immutable. Deletion cascades
--     automatically from auth.users when the account is deleted.
--
-- Normalisation: usernames are stored (and queried) in lowercase, 3-30 chars,
-- letters/digits/underscores/hyphens only. The CHECK constraint enforces this
-- invariant at the DB layer; application code must normalise before inserting.

CREATE TABLE public.usernames (
  username  text PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Normalisation constraints so lookups are deterministic.
  CONSTRAINT username_lowercase    CHECK (username = lower(username)),
  CONSTRAINT username_length       CHECK (char_length(username) BETWEEN 3 AND 30),
  -- NOTE: the pattern here must stay in sync with USERNAME_PATTERN in
  -- lib/auth/username.ts — a divergence will accept usernames at the DB
  -- layer that the app rejects (or vice versa).
  CONSTRAINT username_chars        CHECK (username ~ '^[a-z0-9_-]+$'),

  -- One username per account: prevents a user from registering multiple
  -- usernames (e.g. by racing concurrent sign-up calls).
  CONSTRAINT one_username_per_user UNIQUE (user_id)
);

ALTER TABLE public.usernames ENABLE ROW LEVEL SECURITY;

-- Public read: necessary for pre-session "username taken?" checks.
CREATE POLICY "usernames_select_public"
  ON public.usernames
  FOR SELECT
  USING (true);

-- Owner-only insert: the authenticated user must match the row's user_id.
CREATE POLICY "usernames_insert_own"
  ON public.usernames
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Index on user_id for fast reverse-lookup (account deletion, admin queries).
CREATE INDEX idx_usernames_user_id ON public.usernames (user_id);
