## Why

Username sign-up depends on the Supabase "Confirm email" setting staying off: the synthetic address
cannot receive mail, so with the setting on, `signUp` returns no session and sign-up fails. One door
is holding a project-wide security setting in place. This change makes the door independent of that
setting, so it can be chosen on its own merits. The reasoning for changing the setting is held
privately in ops #398.

Spike only: it waits for Fraser. No Supabase setting changes here.

## What Changes

- `signUpWithUsername` (`lib/auth/actions.ts`) creates the account on the server with
  `admin.createUser` (`email_confirm: true`), then calls `signInWithPassword`, then inserts the
  `usernames` row as before. It no longer calls the public `signUp`.
- With no secret key, sign-up answers `signup_failed` and creates nothing.
- If the sign-in after creation fails, the new user is deleted so the username stays free.
- A taken username is recognised from `email_exists`, the code `admin.createUser` returns.
- `e2e/auth-real.spec.ts`, `.github/workflows/ci.yml` and `.env.local.example` follow: the secret key
  is now needed for username sign-up.
- New capability `username-sign-up` (baseline plus the change); `supabase-keys` gains this caller.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no UI code changes; the same result codes reach the sign-in sheet.
- **Guest mode (localStorage):** no change, because guests never reach this action.
- **Cloud sync and Supabase migrations (both projects):** no migration. The `usernames` insert still runs as the signed-in user under RLS.
- **Superuser mode and QA-seed scenarios:** no change, because neither calls this action.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy or result code is added.
- **Push notifications and the service worker (offline):** no change.
- **Sign-in:** changes. This server action now uses the secret key (service-role access) for the first time. Scope is one function; the key stays server-only through `supabaseSecretKey()`. Accounts that already exist keep signing in, in either setting state. Other sign-in effects of the setting are in ops #398.
- **Privacy notice and sub-processors:** no change, because the same fields go to the same processor.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** one fragment, `changelog.d/unreleased/398-username-sign-up-server-side.md` (`kind: changed`, a patch).
- **CI and GitHub Actions:** changes. The `e2e-real-auth` job needs a new `QA_SUPABASE_SECRET_KEY` secret and stays red without it. That secret is Fraser's to add. Production and preview need `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` set on Vercel.

## Removes

- The public `signUp` call and its `identities.length === 0` handling.
- The no-session guard and its comment, replaced by the sign-in check.
- The "Confirm email MUST be disabled" comments in `lib/auth/actions.ts` and the matching prerequisite in `e2e/auth-real.spec.ts`.

## Out of scope

- Changing any Supabase Auth setting, on QA or production. That needs Fraser's explicit yes.
- Sign-in throttling and CAPTCHA.
- Removing the legacy key fallbacks (#2162).

## Owner decisions relied on

- Every change goes through OpenSpec (21 October 2026).
- Production settings and credentials change only on Fraser's explicit yes (17 October 2026).

## Clarifications

No grilling has happened yet; each line is an open call with a recommendation, dated 2026-11-02.

- **Order of steps?** Recommended: land this first, add the key, then change the setting on QA, then on production. Verified against a local auth server at the deployed version: this code works in both setting states. The setting alone, without this code, breaks username sign-up.
- **Add `QA_SUPABASE_SECRET_KEY` to GitHub?** Recommended: yes, QA project key only. Alternative: skip the `e2e-real-auth` sign-up test, which loses the guard from #1710.
- **Delete the new user when the follow-up sign-in fails?** Recommended: yes, as built. Otherwise a failed sign-up strands the username.
- **Mail handling once the setting is on?** Recommended: decide in ops #398 before the setting changes, including whether the project's current mail set-up is enough.
