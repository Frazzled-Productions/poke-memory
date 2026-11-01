## Context

`signUpWithUsername` calls the public `signUp` and needs a session straight back to insert the
`usernames` row under RLS. The synthetic address cannot receive mail, so that only works with
"Confirm email" off.

## Root cause

The evidence, mechanism and first wrong step are in private issue ops #398, because this repo is public.
In short: one door's need for an instant session was met with a project-wide setting.

**Current behaviour:** username sign-up succeeds only while "Confirm email" is off. With it on, sign-up
answers `signup_failed` and leaves a user with no username row.

**Expected behaviour:** username sign-up works in both setting states.

**Unchanged behaviour:**

- WHEN a valid new username and password are submitted THEN the account is created, signed in and given a `usernames` row, and this SHALL CONTINUE TO hold.
- WHEN the username is taken THEN the result SHALL CONTINUE TO be `username_taken`.
- WHEN the rate limit refuses the request THEN the result SHALL CONTINUE TO be `rate_limited`, with no account created.
- WHEN an account already exists THEN `signInWithUsername` SHALL CONTINUE TO work in both setting states.

## Decisions

- **Admin creation, then a normal sign-in.** Sign-in sets the session cookie through the existing
  server client, so the RLS insert is unchanged. The admin client is used only for create and clean-up.
- **The admin client is built inside the action**, as the feedback route does, with session
  persistence off, so it can never pick up or write the visitor's cookies.
- **Clean up on a failed sign-in.** Create and sign-in are now two calls, which adds a failure window
  the old single call did not have.

- **Log what the visitor cannot explain.** Sign-up now depends on a key, and a missing or wrong key
  looks to the visitor like any other `signup_failed`. The missing key, a failed create and a failed
  clean-up delete each write a server error, with status and code only, never the error message.

## Risks

- **Missing key on a deployment:** username sign-up answers `signup_failed`. Check Vercel production
  and preview before landing.
- **Password-strength rules:** `admin.createUser` applies the same server check as `signUp`
  (`internal/api/admin.go` and `signup.go` at `v2.197.0`).

## Evidence

Local auth server `v2.197.0` in Docker, both setting states, real `@supabase/auth-js`, 12 checks, exit 0:
create on a synthetic address, sign-in returns a session, duplicate gives `email_exists`, delete frees
the address, and an account made with the setting off still signs in with it on. Run through
`auth-js` directly, not the Next.js action. The action itself is covered by mocked unit tests only;
`e2e-real-auth` needs the new secret before it can cover it.

The same run showed a duplicate public `signUp` answers `user_already_exists` with the setting off.
The old code only matched `email_exists`, so a taken username reached the user as `signup_failed`;
this change corrects that as a side effect.
