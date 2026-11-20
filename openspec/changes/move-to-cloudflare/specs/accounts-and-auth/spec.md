## ADDED Requirements

### Requirement: Copied bcrypt passwords verify and are upgraded

Better Auth's password check SHALL accept a stored hash starting `$2a$` or `$2b$` (copied from
Supabase) by checking it with `bcryptjs`, and otherwise use Better Auth's own scrypt. After a successful
username sign-in against a bcrypt hash, an after-hook SHALL replace the stored hash with a scrypt hash
of the same password. A failed check SHALL give the same `invalid_credentials` answer whichever kind of
hash is stored.

#### Scenario: First sign-in after the move

- **WHEN** a username player signs in with the right password and a copied bcrypt hash
- **THEN** the sign-in succeeds and the stored hash no longer starts with `$2`

#### Scenario: Wrong password on a bcrypt hash

- **WHEN** the password is wrong and the stored hash is bcrypt
- **THEN** the result is `invalid_credentials` and the hash is unchanged

#### Scenario: Second sign-in

- **WHEN** the same player signs in again
- **THEN** the scrypt hash is checked and the sign-in succeeds

Source (planned): design D6 "Passwords", `lib/auth/server.ts`.

### Requirement: Every signed-in player signs in once more after the move, with no notice

Sessions SHALL NOT be copied, and the app SHALL show no notice about the move. A player signed in
before the move SHALL find themselves signed out on their next visit, with their local data and
`ownerUserId` still on the device. User ids are copied unchanged, so signing in again SHALL reach the
same account and data, and `guardAccountSwitch` SHALL archive and wipe nothing.

#### Scenario: Returning player, username account

- **WHEN** a player signed in before the move opens the app and signs in again with their username and password
- **THEN** they reach the same account, the guard does nothing, and the sign-in pull merges as for any returning sign-in

#### Scenario: Returning player, OAuth, progress on both sides

- **WHEN** a player with reviewed cards on the device and in the cloud signs in again with GitHub or Google
- **THEN** the keep-local or keep-cloud picker shows once, as it does today when the same player signs in again by OAuth

#### Scenario: Grades made before signing in again

- **WHEN** the player reviews while signed out after the move
- **THEN** the grades stay on the device and reach the cloud after the next sign-in by the existing sync paths

#### Scenario: Two devices

- **WHEN** a player used two devices before the move
- **THEN** each device asks for one sign-in, and each keeps its local data until then

#### Scenario: Offline at first open after the move

- **WHEN** the first open after the move happens with no connection
- **THEN** the app runs as a guest on the local data, and nothing is cleared

#### Scenario: Reminders before signing in again

- **WHEN** a subscribed player has not signed in again
- **THEN** reminders stop: the copied subscriptions were made with the old VAPID key, so pushes signed
  with the new key do not reach them, until the player's next signed-in visit moves the subscription
  onto the new key (push-notifications) and reminders resume

#### Scenario: Background Sync replay with only the old session

- **WHEN** the service worker replays queued grades and the browser holds only the old Supabase cookie
- **THEN** the route answers 401 and the mirror is cleared, as for any expired session today

#### Scenario: A week without a visit

- **WHEN** a player signed in after the move does not open the app for 8 days
- **THEN** they are still signed in: a session lasts 365 days and is renewed at most once a day of use
  (`session.expiresIn` and `updateAge` in `lib/auth/server.ts`), where Better Auth's default would end
  it after 7 days without a visit and Supabase sessions did not lapse

Source (planned): design D6 "Sessions", decision 0018.

### Requirement: Username sign-up creates the account and its session in one step

`signUpWithUsername` SHALL, in order: validate the username and password, check the sign-up rate
limit, and call Better Auth's email sign-up with the synthetic email and the username, which creates
the user, the `credential` account and the username together and signs the player in. It SHALL return
`{ ok: true }` only when Better Auth returns both a user and a session, with the session cookie set.

#### Scenario: No session back from Better Auth

- **WHEN** sign-up returns a user and no session
- **THEN** the result is `signup_failed`

#### Scenario: Username taken

- **WHEN** another account already has the normalised username
- **THEN** the result is `username_taken` and no second account exists

#### Scenario: Two devices pick the same name at once

- **WHEN** two sign-ups for the same username race
- **THEN** one succeeds and the other gets `username_taken`, because the username is unique in D1

#### Scenario: Guest with progress signs up

- **WHEN** a guest with reviewed cards signs up with a username
- **THEN** the browser navigates to `/` and the sign-in pull merges the local cards into the new account

Source (planned): `lib/auth/actions.ts`, `lib/auth/server.ts`; tests `lib/auth/actions.test.ts`.

### Requirement: Taken usernames are recognised from Better Auth's two errors

When sign-up fails, the action SHALL report `username_taken` only when Better Auth returns the
username plugin's taken-username error or its user-already-exists error for the synthetic email. Every
other sign-up error, whatever its status, SHALL report `signup_failed`.

#### Scenario: Username plugin says taken

- **WHEN** sign-up fails with the username plugin's taken-username code
- **THEN** the result is `username_taken`

#### Scenario: Synthetic email exists

- **WHEN** sign-up fails because a user with the synthetic email exists
- **THEN** the result is `username_taken`

#### Scenario: Any other code

- **WHEN** sign-up fails with any other code
- **THEN** the result is `signup_failed`

Source (planned): `lib/auth/actions.ts`; tests `lib/auth/actions.test.ts`.

### Requirement: Sign-out ends every session and keeps local data

The `signOut` server action SHALL revoke every Better Auth session of the user, clear the session
cookie and redirect to `/` whatever that call returns. It SHALL NOT clear local progress, settings or
`ownerUserId`. It is reachable from `AuthButton` and from Settings. When `userId` next becomes null,
`useSignInPull` SHALL reset so that a later sign-in, even as the same user, pulls again.

#### Scenario: Sign out

- **WHEN** a signed-in player presses "Sign out"
- **THEN** the session cookie is cleared, the app navigates to `/`, and local cards stay on the device

#### Scenario: Signed in on two devices

- **WHEN** a player signed in on two devices signs out on one
- **THEN** the session on the other device is revoked too, as it was under Supabase's global sign-out

#### Scenario: Sign-out call fails

- **WHEN** Better Auth's sign-out fails
- **THEN** the app still navigates to `/`, with no error shown

Source (planned): `lib/auth/actions.ts`, `components/auth/AuthButton.tsx:61`, `app/settings/page.tsx:841`,
`lib/sync/useSignInPull.ts:38-41`; tests `e2e/auth.spec.ts`.

### Requirement: Signed-in API routes share a Better Auth session guard

`/api/db`, `/api/sync`, `/api/export` and `/api/push/resubscribe` SHALL call `requireAuth`, which SHALL
read the session from the request headers through Better Auth and return `{ user }` for a valid
session, and otherwise a 401 with `{ error: "unauthorized" }`, or `{ ok: false, error: "unauthorized" }`
when `withOkField` is set. `/api/feedback` SHALL NOT use it: it treats a missing session or an error as
a guest.

#### Scenario: Session read fails

- **WHEN** reading the session throws or returns an error
- **THEN** the caller receives a 401

#### Scenario: Guest sends feedback

- **WHEN** `/api/feedback` is called with no session
- **THEN** the route carries on with a null `user_id`

#### Scenario: Expired session

- **WHEN** the session cookie names a session that has expired or was revoked
- **THEN** the caller receives a 401

Source (planned): `lib/auth/requireAuth.ts`, `app/api/db/route.ts`, `app/api/sync/route.ts`,
`app/api/export/route.ts`, `app/api/push/resubscribe/route.ts`, `app/api/feedback/route.ts`; tests
`lib/auth/requireAuth.test.ts`.

## MODIFIED Requirements

### Requirement: The app header has one auth control (baseline, current behaviour)

`AuthButton` SHALL render nothing while auth is loading, a "Sign in" button that opens `SignInSheet`
for a guest, and for a signed-in user the avatar (when the user has a profile image from GitHub or
Google) and a "Sign out" button. `NavLinks`, `MobileNavSlot` and `NavDrawer` each render it. Settings'
guest account section and `GuestSignUpNudge` on Stats and Journey open the same `SignInSheet`.

#### Scenario: Guest opens the sheet

- **WHEN** a guest presses "Sign in"
- **THEN** the sign-in sheet opens

#### Scenario: Guest opens the sheet from Settings

- **WHEN** a guest presses the sign-in link in Settings' account section
- **THEN** the same sheet opens

#### Scenario: Username account has no avatar

- **WHEN** the signed-in user has no profile image (every username account)
- **THEN** only the "Sign out" button shows

Source: `components/auth/AuthButton.tsx:18-34`, `components/auth/AuthButton.tsx:36-67`,
`components/NavLinks.tsx:68`, `components/MobileNavSlot.tsx:55`, `components/NavDrawer.tsx:288`,
`app/settings/page.tsx:804`, `app/settings/page.tsx:2312-2315`,
`components/onboarding/GuestSignUpNudge.tsx:74`, `app/stats/page.tsx:468`, `app/journey/page.tsx:666`;
tests `components/auth/AuthButton.test.tsx:189`.

### Requirement: OAuth sign-in accepts GitHub and Google only (baseline, current behaviour)

The `signIn` server action SHALL start Better Auth social sign-in for `github` or `google`, with the
callback URL `/auth/callback-complete` on the site's base URL (`BETTER_AUTH_URL`), and redirect to the
provider URL. Any other provider, a Better Auth error or a missing URL SHALL redirect to `/` with no
error shown. The sheet SHALL stay open during the redirect.

#### Scenario: Unknown provider

- **WHEN** `signIn` is called with a provider other than `github` or `google`
- **THEN** it redirects to `/` and never calls Better Auth

#### Scenario: Provider start fails

- **WHEN** Better Auth returns an error or no URL
- **THEN** the player lands on `/` with no error banner

Source (planned): `lib/auth/actions.ts`, `lib/auth/server.ts`, `lib/auth/types.ts:1`,
`components/auth/SignInSheet.tsx:151-155`; tests `components/auth/SignInSheet.test.tsx`.

### Requirement: The OAuth callback exchanges the code (baseline, current behaviour)

Better Auth's `GET /api/auth/callback/<provider>` SHALL check the state, exchange the `code` for a
session, set the session cookie and redirect to `/auth/callback-complete`. A missing code, a bad state
or a failed exchange SHALL redirect to `/` with an `error` query parameter, and the home page SHALL
show the translated `signInFailed` alert for any `error` value. The old `/api/auth/callback` route and
`exchangeCodeForSession` SHALL no longer exist.

#### Scenario: Good code

- **WHEN** the exchange succeeds
- **THEN** the browser is sent to `/auth/callback-complete` with the session cookie set

#### Scenario: No code

- **WHEN** the callback has no `code`
- **THEN** no session is created and the browser lands on `/` with an `error` parameter and the sign-in failure alert

#### Scenario: Japanese locale

- **WHEN** the locale is `ja` and the callback fails
- **THEN** the sign-in failure alert is in Japanese

#### Scenario: Old callback URL

- **WHEN** a request reaches `/api/auth/callback` with no provider segment
- **THEN** it answers 404 and no session is created

Source (planned): `app/api/auth/[...all]/route.ts`, `app/page.tsx`; design D6.

### Requirement: Usernames are normalised and validated (baseline, current behaviour)

A username SHALL be trimmed and lowercased, then accepted only if it is 3 to 30 characters of `a-z`,
`0-9`, `_` and `-`; Better Auth's username plugin SHALL use this rule, not its own default. Passwords
SHALL be at least 8 characters. D1 SHALL enforce the same username rules with CHECK constraints and one
unique username per account, and no browser query SHALL read or write usernames.

#### Scenario: Mixed case with spaces

- **WHEN** the player enters `  Trainer99 `
- **THEN** the username used is `trainer99`

#### Scenario: Two characters

- **WHEN** the normalised username has 2 characters
- **THEN** validation returns `username_too_short`

#### Scenario: A dot in the name

- **WHEN** the player enters `ash.ketchum`, which Better Auth's default rule would allow
- **THEN** validation refuses it, as today

#### Scenario: Browser asks for usernames

- **WHEN** a signed-in browser queries usernames through the data gateway
- **THEN** the gateway refuses it with 400

Source: `lib/auth/username.ts:27`, `lib/auth/username.ts:30`, `lib/auth/username.ts:44-46`,
`lib/auth/username.ts:64-69`; planned `lib/auth/server.ts`, `db/d1/migrations/0002_auth.sql`;
tests `lib/auth/username.test.ts:24-114`.

### Requirement: Username sign-in gives one answer for bad credentials (baseline, current behaviour)

`signInWithUsername` SHALL return `invalid_credentials` for a username that fails validation and for
any error from Better Auth's username sign-in, and SHALL NOT reveal whether the username exists. A
valid username SHALL pass the rate limit before the password is checked.

#### Scenario: Malformed username

- **WHEN** the username fails validation
- **THEN** the result is `invalid_credentials` and neither the rate limit nor Better Auth is called

#### Scenario: Wrong password

- **WHEN** Better Auth's sign-in returns an error
- **THEN** the result is `invalid_credentials`

#### Scenario: Unknown username

- **WHEN** no account has the username
- **THEN** the result is `invalid_credentials`, the same as a wrong password

Source (planned): `lib/auth/actions.ts`; tests `lib/auth/actions.test.ts`.

### Requirement: Username sign-up and sign-in are throttled per IP (baseline, current behaviour)

Both username actions SHALL check per-IP buckets in D1 in a Better Auth `before` hook, keyed by
SHA-256 of `RATE_LIMIT_SALT` plus the `cf-connecting-ip` header (or `unknown`); raw IPs SHALL NOT be
stored. A refusal or database error SHALL return `rate_limited`. Caps: `signup` 5 per 10 minutes and
20 per hour, `signin` 10 per 10 minutes and 40 per hour; an attempt over a cap is not counted.

#### Scenario: Database unavailable

- **WHEN** the bucket check fails
- **THEN** the action returns `rate_limited` and no account is read

#### Scenario: No forwarded header

- **WHEN** the request has no `cf-connecting-ip` header
- **THEN** the attempt counts against the shared `unknown` value

#### Scenario: Sixth sign-up in ten minutes

- **WHEN** the same IP makes a sixth sign-up attempt within 10 minutes
- **THEN** the result is `rate_limited`

#### Scenario: Spoofed forwarding header

- **WHEN** a client sends its own `x-forwarded-for` value
- **THEN** the bucket still uses the IP Cloudflare saw

Source (planned): `lib/auth/rateLimitIp.ts`, `lib/auth/server.ts`, `lib/db/system.ts`; design D6
"Per-IP throttle".

### Requirement: Auth state in the browser (baseline, current behaviour)

`AuthProvider`, mounted in the root layout, SHALL follow the session with Better Auth's React client
(`useSession`) and expose `{ user, loading }`, with `user` null when there is no session. It SHALL NOT
carry a database client; callers create the data client. `useAuth` SHALL throw outside the provider. A
server action that changes the session SHALL be followed by a full navigation, because the browser's
session state does not see it directly.

#### Scenario: No credentials in the build

- **WHEN** the app is built without auth secrets, as in CI, and the session request fails
- **THEN** the app renders as a guest with `loading` false

#### Scenario: Auth event

- **WHEN** the session ends and the client refetches it
- **THEN** `user` becomes null

#### Scenario: Offline on load

- **WHEN** the session request fails because the device is offline
- **THEN** `user` is null and `loading` becomes false, and local data is not touched

Source (planned): `lib/auth/AuthContext.tsx`, `lib/auth/client.ts`, `app/layout.tsx`; tests
`components/auth/AuthProvider.test.tsx`.

### Requirement: The server client uses the request's cookies (baseline, current behaviour)

Server code SHALL read the session by passing the request's headers, with its cookies, to Better
Auth, built per request from the D1 binding. A cookie write that cannot happen because it runs in a
Server Component SHALL be skipped without failing the render. The repo has no `middleware.ts` or
`proxy.ts`, so a session is refreshed only by the code that uses it.

#### Scenario: Write during a Server Component render

- **WHEN** Better Auth would refresh the session cookie during a Server Component render
- **THEN** the write is skipped and the render continues

#### Scenario: Only an old Supabase cookie

- **WHEN** a request carries only the old Supabase session cookie
- **THEN** no session is found

Source (planned): `lib/auth/server.ts`, `lib/auth/requireAuth.ts`.

### Requirement: A signed-in player can connect the other provider (baseline, current behaviour)

Settings SHALL list the connected GitHub and Google accounts from Better Auth (other providers
ignored) and offer Connect for each one not connected. Connect SHALL call Better Auth's social link
with the callback URL `/auth/callback-complete`. Linking SHALL work across GitHub, Google and username
accounts, also when the emails differ. An error starting the link SHALL show a mapped message and
re-enable the button.

#### Scenario: Both connected

- **WHEN** GitHub and Google are both connected
- **THEN** the section says all methods are connected and offers no button

#### Scenario: Link succeeds with progress on both sides

- **WHEN** the provider returns to `/auth/callback-complete` and local and cloud both have reviewed cards
- **THEN** the sync conflict picker shows, as it does after a sign-in

#### Scenario: Link comes back with no code

- **WHEN** the provider step fails or returns without a `code`
- **THEN** the player lands on `/` with an `error` parameter and the sign-in failure alert, not one of the mapped link messages

#### Scenario: Username account adds GitHub

- **WHEN** a username player connects a GitHub account with a real email
- **THEN** both sign-in methods reach the same user id

Source (planned): `components/auth/LinkIdentitiesSection.tsx`, `lib/auth/client.ts`,
`lib/auth/server.ts`, `app/settings/page.tsx:2088-2090`; tests
`components/auth/LinkIdentitiesSection.test.tsx`.

### Requirement: Cloud deletion removes the identity (baseline, current behaviour)

`deleteAccount` SHALL call the `delete_account` RPC through the data gateway and return true or false,
logging failures and never throwing. The Worker SHALL take the user id from the session only, answer
401 with no session, and in one atomic D1 batch delete the user's rows in every per-user table, their
username, and the Better Auth user with its sessions and accounts. Nothing SHALL be sent afterwards:
the bug-report emails hold no user id (`feedback-and-operator-tools`).

#### Scenario: RPC error

- **WHEN** the RPC returns an error
- **THEN** `deleteAccount` logs it and returns false

#### Scenario: Every table emptied

- **WHEN** a player deletes their account
- **THEN** `card_reviews`, `streak_days`, `user_settings`, `grade_log`, `push_subscriptions`, `feedback` and the auth tables hold no row for that user id, and another user's rows are unchanged

#### Scenario: Signed in on another device

- **WHEN** the player deletes their account on one device while signed in on another
- **THEN** the other device's next request answers 401, because its session was deleted

Source (planned): `lib/sync/deleteAccount.ts`, `lib/db/rpc/deleteAccount.ts`; tests
`lib/sync/deleteAccount.test.ts`, the delete-account test against the D1 test database (task 4.5).

## REMOVED Requirements

### Requirement: Username sign-up creates the account in the browser's session (baseline, current behaviour)

**Reason**: Supabase `signUp` and the separate `usernames` insert are gone; Better Auth creates the
user, account and username in one step, so the row-conflict and no-rollback cases no longer exist.

**Migration**: Replaced by "Username sign-up creates the account and its session in one step".

### Requirement: Taken usernames are recognised from two signals only (baseline, current behaviour)

**Reason**: The two signals were Supabase's `email_exists` code and an empty `identities` list, which
Better Auth does not return.

**Migration**: Replaced by "Taken usernames are recognised from Better Auth's two errors".

### Requirement: Sign-out ends the session and keeps local data (baseline, current behaviour)

**Reason**: It described Supabase's `auth.signOut()` and its 401, 403 and 404 handling.

**Migration**: Replaced by "Sign-out ends every session and keeps local data", which keeps the
two-device behaviour.

### Requirement: Signed-in API routes share a session guard (baseline, current behaviour)

**Reason**: The guard read the session with Supabase's `getUser`, and `/api/srs/optimize` is removed.

**Migration**: Replaced by "Signed-in API routes share a Better Auth session guard", which adds
`/api/db`.
