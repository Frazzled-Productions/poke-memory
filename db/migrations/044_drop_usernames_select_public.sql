-- Drop the now-dead usernames_select_public RLS policy (#1815).
-- The open SELECT policy (USING (true)) was required during the original
-- username-door build when sign-up checked availability via a client-side
-- SELECT. Since the throttle PR, the entire sign-up/sign-in path runs through
-- Server Actions; signInWithUsername derives the synthetic email and never
-- queries the table, and signUpWithUsername detects conflicts via GoTrue's
-- email_exists and the 23505 PK violation on INSERT. No surface reads a user's
-- own username row via an RLS-bound client (username is in user_metadata).
DROP POLICY IF EXISTS "usernames_select_public" ON public.usernames;
