# accounts-and-auth Specification

## Purpose
How a Poké Memory player gets an account, signs in and out, connects a second sign-in method and
deletes the account, and how local data on a device is tied to the signed-in account. This is the
baseline: it records what the code and tests on `qa` do today (commit `d2456f4`), not what they
should do. Which Supabase key each client uses is in `supabase-keys`. What sync does after sign-in
(the merge itself, cursors, pushes) is not covered here. Every requirement names its source as
`file:line`.

## Requirements

### Requirement: The app header has one auth control (baseline, current behaviour)

`AuthButton` SHALL render nothing while auth is loading, a "Sign in" button that opens `SignInSheet`
for a guest, and for a signed-in user the avatar (when `user_metadata.avatar_url` exists) and a
"Sign out" button. `NavLinks`, `MobileNavSlot` and `NavDrawer` each render it. The header is not the
only way in: Settings' guest account section and `GuestSignUpNudge` on Stats and Journey open the
same `SignInSheet`.

#### Scenario: Guest opens the sheet

- **WHEN** a guest presses "Sign in"
- **THEN** the sign-in sheet opens

#### Scenario: Guest opens the sheet from Settings

- **WHEN** a guest presses the sign-in link in Settings' account section
- **THEN** the same sheet opens

#### Scenario: Username account has no avatar

- **WHEN** the signed-in user has no `avatar_url` in their metadata (every username account)
- **THEN** only the "Sign out" button shows

Source: `components/auth/AuthButton.tsx:18-34`, `components/auth/AuthButton.tsx:36-67`,
`components/NavLinks.tsx:68`, `components/MobileNavSlot.tsx:55`, `components/NavDrawer.tsx:288`,
`app/settings/page.tsx:804`, `app/settings/page.tsx:2312-2315`,
`components/onboarding/GuestSignUpNudge.tsx:74`, `app/stats/page.tsx:468`, `app/journey/page.tsx:666`;
tests `components/auth/AuthButton.test.tsx:189`.

### Requirement: The sign-in sheet is a modal dialog (baseline, current behaviour)

`SignInSheet` SHALL render through a portal, mark `#app-root` inert and `aria-hidden` while open, move
focus to its close button, trap Tab, close on Escape, on the close button and on a backdrop press,
and restore focus to the previously focused element on close. It SHALL lock page scroll while open.

#### Scenario: Escape closes and restores focus

- **WHEN** the sheet is open and the player presses Escape
- **THEN** the sheet closes and focus returns to the control that opened it

#### Scenario: Press inside the panel

- **WHEN** the player presses inside the dialog panel
- **THEN** the sheet stays open

Source: `components/auth/SignInSheet.tsx:78-96`, `components/auth/SignInSheet.tsx:98-103`,
`components/auth/SignInSheet.tsx:106-149`, `components/auth/SignInSheet.tsx:226-234`; tests
`components/auth/SignInSheet.test.tsx:123-195`.

### Requirement: OAuth sign-in accepts GitHub and Google only (baseline, current behaviour)

The `signIn` server action SHALL start Supabase OAuth for `github` or `google`, with
`redirectTo` set to `NEXT_PUBLIC_SITE_URL` (or `http://localhost:3000`) plus `/api/auth/callback`,
and redirect to the provider URL. Any other provider, a Supabase error or a missing URL SHALL
redirect to `/` with no error shown. The sheet SHALL stay open during the redirect.

#### Scenario: Unknown provider

- **WHEN** `signIn` is called with a provider other than `github` or `google`
- **THEN** it redirects to `/` and never calls Supabase

#### Scenario: Provider start fails

- **WHEN** `signInWithOAuth` returns an error
- **THEN** the player lands on `/` with no error banner

Source: `lib/auth/actions.ts:10-22`, `lib/auth/types.ts:1`, `components/auth/SignInSheet.tsx:151-155`;
tests `components/auth/SignInSheet.test.tsx:206-218`.

### Requirement: The OAuth callback exchanges the code (baseline, current behaviour)

`GET /api/auth/callback` SHALL exchange the `code` query parameter for a session and redirect to
`/auth/callback-complete`. A missing or empty code, or a failed exchange, SHALL redirect to
`/?error=auth`, and the home page SHALL show the translated `signInFailed` alert for that value.
Both redirects SHALL use `NEXT_PUBLIC_SITE_URL`, falling back to `http://localhost:3000`.

#### Scenario: Good code

- **WHEN** the exchange succeeds
- **THEN** the browser is sent to `/auth/callback-complete`

#### Scenario: No code

- **WHEN** the callback has no `code`
- **THEN** no exchange is attempted and the browser is sent to `/?error=auth`

Source: `app/api/auth/callback/route.ts:4-16`, `app/page.tsx:16-32`; tests
`app/api/auth/callback/route.test.tsx:85-154`.

### Requirement: Usernames are normalised and validated (baseline, current behaviour)

A username SHALL be trimmed and lowercased, then accepted only if it is 3 to 30 characters of
`a-z`, `0-9`, `_` and `-`. Passwords SHALL be at least 8 characters. The database SHALL enforce the
same username rules with CHECK constraints, one username per account, and an owner-only INSERT with
no client SELECT, UPDATE or DELETE policy.

#### Scenario: Mixed case with spaces

- **WHEN** the player enters `  Trainer99 `
- **THEN** the username used is `trainer99`

#### Scenario: Two characters

- **WHEN** the normalised username has 2 characters
- **THEN** validation returns `username_too_short`

Source: `lib/auth/username.ts:27`, `lib/auth/username.ts:30`, `lib/auth/username.ts:44-46`,
`lib/auth/username.ts:64-69`, `db/migrations/035_usernames.sql:22-37`,
`db/migrations/035_usernames.sql:48-51`, `db/migrations/044_drop_usernames_select_public.sql:9`;
tests `lib/auth/username.test.ts:24-114`.

### Requirement: A username maps to a synthetic email (baseline, current behaviour)

The Auth login identifier for a username account SHALL be
`<normalised username>@users.noreply.pokememory.internal`, and neither action's result SHALL contain
that address or the password.

#### Scenario: Same username twice

- **WHEN** the same normalised username is derived twice
- **THEN** both produce the same address

Source: `lib/auth/username.ts:21`, `lib/auth/username.ts:84-86`, `lib/auth/actions.ts:85`,
`lib/auth/actions.ts:208`; tests `lib/auth/actions.test.ts:121-140`, `lib/auth/username.test.ts:147-167`.

### Requirement: Username sign-up creates the account in the browser's session (baseline, current behaviour)

`signUpWithUsername` SHALL, in order: validate the username and password, check the sign-up rate
limit, call Supabase `signUp` with the synthetic email and `user_metadata.username`, require both a
user and a session, then insert the `usernames` row. It SHALL return `{ ok: true }` only when all of
those succeed. There SHALL be no rollback of the Auth user when a later step fails.

#### Scenario: No session back from Supabase

- **WHEN** `signUp` returns a user and no session
- **THEN** the result is `signup_failed` and no `usernames` row is attempted

#### Scenario: Username row conflict

- **WHEN** the `usernames` insert fails with Postgres code `23505`
- **THEN** the result is `username_taken`

#### Scenario: Username row fails for another reason

- **WHEN** the `usernames` insert fails with any other error after `signUp` returned a session
- **THEN** the result is `signup_failed`, and the Auth user and the session already written stay in place

Source: `lib/auth/actions.ts:53-160`; tests `lib/auth/actions.test.ts:111-117`,
`lib/auth/actions.test.ts:227`.

### Requirement: Taken usernames are recognised from two signals only (baseline, current behaviour)

When `signUp` returns an error, the action SHALL report `username_taken` only when the error `code`
is `email_exists` or the returned user has an empty `identities` list. Every other sign-up error,
whatever its status, SHALL report `signup_failed`.

#### Scenario: email_exists

- **WHEN** `signUp` fails with code `email_exists`
- **THEN** the result is `username_taken`

#### Scenario: Any other code

- **WHEN** `signUp` fails with a code other than `email_exists` and no empty `identities` list, including `user_already_exists`
- **THEN** the result is `signup_failed`

Source: `lib/auth/actions.ts:101-120`; tests `lib/auth/actions.test.ts:167-192`.

### Requirement: Username sign-in gives one answer for bad credentials (baseline, current behaviour)

`signInWithUsername` SHALL return `invalid_credentials` for a username that fails validation and for
any error from `signInWithPassword`, and SHALL NOT read the `usernames` table. A valid username SHALL
pass the rate limit before Supabase is called.

#### Scenario: Malformed username

- **WHEN** the username fails validation
- **THEN** the result is `invalid_credentials` and neither the rate limit nor Supabase is called

#### Scenario: Wrong password

- **WHEN** `signInWithPassword` returns an error
- **THEN** the result is `invalid_credentials`

Source: `lib/auth/actions.ts:179-217`; tests `lib/auth/actions.test.ts:13-23`.

### Requirement: Username sign-up and sign-in are throttled per IP (baseline, current behaviour)

Both username actions SHALL hash the first `x-forwarded-for` value (or the literal `unknown`) as
SHA-256 of `RATE_LIMIT_SALT` plus the IP, falling back to the salt `dev-salt`, and call
`check_rate_limit` before Auth. A `false` result or an RPC error SHALL return `rate_limited`. The
caps SHALL be 5 per 10 minutes and 20 per hour for `signup`, and 10 per 10 minutes and 40 per hour
for `signin`; an attempt over a cap is not counted. Raw IPs SHALL NOT be stored.

#### Scenario: Database unavailable

- **WHEN** `check_rate_limit` returns an error
- **THEN** the action returns `rate_limited` and Auth is not called

#### Scenario: No forwarded header

- **WHEN** the request has no `x-forwarded-for` header
- **THEN** the attempt counts against the shared `unknown` value

Source: `lib/auth/actions.ts:70-83`, `lib/auth/actions.ts:193-206`, `lib/auth/rateLimitIp.ts:25`,
`lib/auth/rateLimitIp.ts:36-38`, `db/migrations/045_check_rate_limit_feedback_action.sql:18-50`;
tests `lib/auth/rateLimitIp.test.ts:19-67`, `lib/auth/actions.test.ts:20-23`.

### Requirement: The username form validates and then navigates (baseline, current behaviour)

The sheet's username form SHALL default to sign-up mode, show the no-password-reset and no-real-name
warnings only in that mode, validate the username format and the password length before calling the
server in both modes, and show a translated inline alert for each error. On success it SHALL do a full navigation to `/`,
because the server action writes the session cookie without the browser client noticing. Closing
the sheet SHALL clear the form and return it to sign-up mode.

#### Scenario: Short password in sign-in mode

- **WHEN** a password under 8 characters is submitted in either mode
- **THEN** the alert shows and no server action is called

#### Scenario: Malformed username in sign-in mode

- **WHEN** a username that fails validation is submitted in sign-in mode
- **THEN** the alert names the format problem, not `invalid_credentials`, and no server action is called

#### Scenario: Japanese locale

- **WHEN** the locale is `ja` and the sheet is open
- **THEN** the heading, the provider buttons and the warnings are in Japanese

#### Scenario: Successful sign-up

- **WHEN** the server action returns `{ ok: true }`
- **THEN** the browser does `window.location.assign("/")`

Source: `components/auth/SignInSheet.tsx:53`, `components/auth/SignInSheet.tsx:65-72`,
`components/auth/SignInSheet.tsx:157-222`, `components/auth/SignInSheet.tsx:313-328`,
`components/auth/SignInSheet.tsx:400-412`; tests `components/auth/SignInSheet.test.tsx:238-442`,
`e2e/auth-real.spec.ts:145-202`.

### Requirement: Auth state in the browser (baseline, current behaviour)

`AuthProvider`, mounted in the root layout, SHALL read the user once with `getUser()` on mount and
then follow `onAuthStateChange`. If the Supabase env vars are absent it SHALL render children with
`supabase: null`, `user: null` and `loading: false`. `useAuth` SHALL throw outside the provider. The
browser client is the only route to `user`; a server action SHALL NOT update it directly.

#### Scenario: No credentials in the build

- **WHEN** `createClient` throws
- **THEN** the app renders as a guest and `getUser` is never called

#### Scenario: Auth event

- **WHEN** `onAuthStateChange` fires `SIGNED_OUT`
- **THEN** `user` becomes null

Source: `lib/auth/AuthContext.tsx:18-24`, `lib/auth/AuthContext.tsx:26-64`,
`lib/auth/AuthContext.tsx:66-70`, `app/layout.tsx:178`, `lib/supabase/client.ts:5-10`; tests
`components/auth/AuthProvider.test.tsx:105-254`.

### Requirement: The server client uses the request's cookies (baseline, current behaviour)

The server Supabase client SHALL read and write the session through the Next.js cookie store, and
SHALL ignore a cookie write that fails because it runs in a Server Component. The repo has no
`middleware.ts` or `proxy.ts`, so a session is refreshed only by the code that uses it.

#### Scenario: Write during a Server Component render

- **WHEN** Supabase tries to set cookies during a Server Component render
- **THEN** the error is swallowed and the render continues

Source: `lib/supabase/server.ts:8-32`; tests `lib/supabase/clients.test.ts`.

### Requirement: Sign-out ends the session and keeps local data (baseline, current behaviour)

The `signOut` server action SHALL call `auth.signOut()` with no options on the server client and
redirect to `/` whatever that call returns. It SHALL NOT clear local progress, settings or `ownerUserId`, and SHALL NOT call the browser Supabase
client. It is reachable from `AuthButton` and from Settings. When `userId` next becomes null,
`useSignInPull` SHALL reset so that a later sign-in, even as the same user, pulls again.

#### Scenario: Sign out

- **WHEN** a signed-in player presses "Sign out"
- **THEN** the session cookies are cleared, the app navigates to `/`, and local cards stay on the device

#### Scenario: Signed in on two devices

- **WHEN** a player signed in on two devices signs out on one
- **THEN** the session on the other device is revoked too, because the upstream default scope is `global`

#### Scenario: Supabase refuses the sign-out

- **WHEN** `auth.signOut()` fails with anything other than a 401, 403 or 404
- **THEN** the session stays in place and the app still navigates to `/`, with no error shown

Source: `lib/auth/actions.ts:24-28`, `components/auth/AuthButton.tsx:61`, `app/settings/page.tsx:841`,
`lib/sync/useSignInPull.ts:38-41`, `lib/sync/deleteAccount.ts:36-39`; tests `e2e/auth.spec.ts:66-76`.

### Requirement: Signed-in API routes share a session guard (baseline, current behaviour)

`/api/sync`, `/api/export`, `/api/srs/optimize` and `/api/push/resubscribe` SHALL call `requireAuth`,
which SHALL return `{ user }` for a valid session and otherwise a 401 response with
`{ error: "unauthorized" }`, or `{ ok: false, error: "unauthorized" }` when `withOkField` is set. `/api/feedback` SHALL NOT use it: it
reads the user itself and treats a missing user or an error as a guest.

#### Scenario: getUser reports an error

- **WHEN** `getUser` returns an error
- **THEN** the caller receives a 401

#### Scenario: Guest sends feedback

- **WHEN** `/api/feedback` is called with no session
- **THEN** the route carries on with a null `user_id`

Source: `lib/auth/requireAuth.ts:22-39`, `app/api/sync/route.ts:52`, `app/api/export/route.ts:110`,
`app/api/srs/optimize/route.ts:174`, `app/api/push/resubscribe/route.ts:37`,
`app/api/feedback/route.ts:87-94`; tests `lib/auth/requireAuth.test.ts:21-55`.

### Requirement: Cron routes compare the bearer header in constant time (baseline, current behaviour)

`isAuthorized` SHALL return false for a missing header, an empty secret or a different length, and
otherwise compare `Bearer <secret>` with `timingSafeEqual`, returning false rather than throwing.

#### Scenario: Lowercase scheme

- **WHEN** the header is `bearer <secret>`
- **THEN** the result is false

#### Scenario: Empty configured secret

- **WHEN** the secret is empty
- **THEN** the result is false

Source: `lib/auth/bearerAuth.ts:18-30`; tests `lib/auth/bearerAuth.test.ts:7-41`.

### Requirement: The mock-auth seam cannot run in production (baseline, current behaviour)

`isMockAuthEnabled` SHALL be true only when `NEXT_PUBLIC_E2E_AUTH_MOCK` is `1` and `NODE_ENV` is not
`production`. `next.config.ts` SHALL fail the build when the flag is set with a production
`NODE_ENV`. When enabled, `AuthProvider` SHALL start signed in as a fixed fake user with no network
calls, and writes SHALL be discarded.

#### Scenario: Flag set in production

- **WHEN** `NODE_ENV` is `production` and the flag is `1`
- **THEN** `isMockAuthEnabled` returns false and `next build` throws

Source: `lib/auth/mockAuth.ts:52-58`, `lib/auth/mockAuth.ts:69-83`, `lib/auth/mockAuth.ts:252-296`,
`lib/auth/AuthContext.tsx:30-42`, `next.config.ts:11`; tests `lib/auth/mockAuth.test.ts:32-42`.

### Requirement: A signed-in player can connect the other provider (baseline, current behaviour)

The Settings section SHALL list connected GitHub and Google identities, ignoring other providers,
and offer a Connect button for each one not connected. Connect SHALL call the browser client's
`linkIdentity` with `redirectTo` set to `/api/auth/callback`, so a successful link returns through
the same callback and `/auth/callback-complete` as a sign-in. An error SHALL show a mapped message
and re-enable the button.

#### Scenario: Both connected

- **WHEN** GitHub and Google are both connected
- **THEN** the section says all methods are connected and offers no button

#### Scenario: Link succeeds with progress on both sides

- **WHEN** the provider returns to `/auth/callback-complete` and local and cloud both have reviewed cards
- **THEN** the sync conflict picker shows, as it does after a sign-in

#### Scenario: Link comes back with no code

- **WHEN** the provider step returns to `/api/auth/callback` without a `code`
- **THEN** the player lands on `/?error=auth` with the sign-in failure alert, not one of the mapped link messages

Source: `app/api/auth/callback/route.ts:8-15`, `components/auth/LinkIdentitiesSection.tsx:42-52`, `components/auth/LinkIdentitiesSection.tsx:57-78`,
`components/auth/LinkIdentitiesSection.tsx:121-156`, `app/settings/page.tsx:2088-2090`; tests
`components/auth/LinkIdentitiesSection.test.tsx:54-354`.

### Requirement: Callback-complete sorts the first arrival by what data exists (baseline, current behaviour)

`/auth/callback-complete` SHALL wait for auth and the seed, send a missing user or client to `/`, and
compare local reviewed cards with cloud rows. It is reached only through the OAuth callback; the
username door goes straight to `/`. With neither side holding data it SHALL stamp `ownerUserId` and
go to `/`. A failed `hasCloudData` read SHALL count as an empty cloud; only a failed `pullSession`
SHALL show "Could not reach the cloud" with Retry.

#### Scenario: New user, nothing anywhere

- **WHEN** there are no local reviewed cards and no cloud rows
- **THEN** `ownerUserId` is set to the user and the app goes to `/`

#### Scenario: First cloud read fails

- **WHEN** the `card_reviews` count query fails
- **THEN** `hasCloudData` catches the failure and returns false, no error screen shows, and the page carries on as if the cloud held no rows

#### Scenario: Full pull fails

- **WHEN** `hasCloudData` returns true and `pullSession` returns null
- **THEN** the error screen shows, and Retry runs the check again

Source: `app/auth/callback-complete/page.tsx:97-136`, `app/auth/callback-complete/page.tsx:403-415`,
`lib/sync/cloud.ts:150-165`, `components/auth/SignInSheet.tsx:211`. No test covers the error screen;
the page tests mock `hasCloudData` and only ever resolve it.

### Requirement: Local-only progress is pushed on first arrival (baseline, current behaviour)

With local reviewed cards and no cloud rows, the page SHALL push cards only (not settings, streak or
grade log) and stamp `ownerUserId`, recording the push result in sync status. A failed push SHALL
show a warning with Continue. With any superuser flag on it SHALL go to `/` without pushing or
stamping.

#### Scenario: Guest with progress signs in

- **WHEN** a guest with reviewed cards signs in to an empty cloud account
- **THEN** the cards are pushed and `ownerUserId` is the new user

#### Scenario: Superuser flag on

- **WHEN** a guest with a QA seed signs in with a superuser flag on
- **THEN** nothing is pushed and the app goes to `/`

Source: `app/auth/callback-complete/page.tsx:148-172`, `app/auth/callback-complete/page.tsx:417-429`;
tests `app/auth/callback-complete/page.test.tsx:281`.

### Requirement: Cloud-only progress is applied without a question (baseline, current behaviour)

With cloud rows and no local reviewed cards, the page SHALL pull settings, streak, grade log and
regional prefs (each failure treated as absent), apply them with the cloud cards as the truth,
advance the sync cursors, stamp `ownerUserId` and go to `/`.

#### Scenario: New device

- **WHEN** a player signs in on a device with no reviewed cards and has cloud cards
- **THEN** local state becomes the cloud state and no picker shows

Source: `app/auth/callback-complete/page.tsx:173-194`, `app/auth/callback-complete/page.tsx:232-300`.

### Requirement: Progress on both sides asks the player to pick one (baseline, current behaviour)

With local reviewed cards and at least one cloud row, reviewed or not, the page SHALL show a picker
with the reviewed card, streak and grade counts and the latest review date for each side, whoever
owns the device's data and however close the two sides are. "Keep local" SHALL push cards and,
best-effort, settings, regional prefs, streak and grade log. "Keep cloud" SHALL apply the cloud
state. Both SHALL stamp `ownerUserId`.

#### Scenario: Cloud rows but no cloud reviews

- **WHEN** local has reviewed cards and every cloud row has a null `last_review`
- **THEN** the picker shows with 0 reviewed cards on the cloud side

#### Scenario: Same player returns to the same device

- **WHEN** a player whose `ownerUserId` is on this device signs in again by OAuth and both sides have reviewed cards
- **THEN** the picker shows

#### Scenario: Cloud streak read fails

- **WHEN** the streak or grade log read fails
- **THEN** that cloud count shows 0, and "Keep cloud" leaves the local copy in place

#### Scenario: Keep cloud fails

- **WHEN** applying the cloud state throws
- **THEN** the error screen shows

#### Scenario: Keep local fails

- **WHEN** the card push fails
- **THEN** the warning screen shows and `ownerUserId` is still stamped

#### Scenario: Japanese locale

- **WHEN** the locale is `ja`
- **THEN** the headings, explanation and button labels stay in hard-coded English, and only the counts are translated. On the loading screen the `aria-label` is translated and the visible text is not; the error and push-warning screens are hard-coded English

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on and the picker shows
- **THEN** "Keep local" is replaced by a disabled "Sync paused (superuser)" button

Source: `app/auth/callback-complete/page.tsx:195-226`, `app/auth/callback-complete/page.tsx:302-390`,
`app/auth/callback-complete/page.tsx:431-468`, `app/auth/callback-complete/page.tsx:514-534`,
`app/auth/callback-complete/page.tsx:125`, `app/auth/callback-complete/page.tsx:392-429`;
tests `app/auth/callback-complete/page.test.tsx:326-406`, `e2e/auth.spec.ts:78`.

### Requirement: Sign-in runs the account guard before each pull (baseline, current behaviour)

`SignInPull`, mounted in the root layout, SHALL run once per change of `userId` to a new non-null
value, including a cold load. It SHALL await `guardAccountSwitch` and then call `pullAndMerge`, which
SHALL write the incoming user as `ownerUserId` only at the end of a successful pass; a failed pull or
save leaves `ownerUserId` as it was. Reads SHALL run with a superuser
flag on; only the push-back inside `pullAndMerge` is suppressed.

#### Scenario: Re-render

- **WHEN** the component re-renders with the same `userId`
- **THEN** no second pull starts

#### Scenario: Guest signs in through the username door

- **WHEN** a guest with local cards signs in with a username
- **THEN** no picker shows, the guard does nothing, and `pullAndMerge` merges and sets `ownerUserId`

#### Scenario: Guest's first pull fails

- **WHEN** a guest signs in and `pullAndMerge` returns `error`
- **THEN** `ownerUserId` stays null

Source: `components/sync/SignInPull.tsx:12-19`, `app/layout.tsx:202`, `lib/sync/useSignInPull.ts:25-53`,
`lib/sync/pullAndMerge.ts:152`, `lib/sync/pullAndMerge.ts:351`, `lib/sync/pullAndMerge.ts:620-631`; tests `components/sync/useSignInPull.test.tsx`.

### Requirement: The account guard isolates local data between accounts (baseline, current behaviour)

`guardAccountSwitch` SHALL do nothing when `ownerUserId` is null or equals the incoming user. For a
different user it SHALL, in order: archive the outgoing user under
`poke-memory:user-archive:<id>`; clear the IndexedDB pending-grade queue, review session and grade
log; wipe per-user localStorage keys; restore the incoming user's archive if any; and write a fresh
sync status unless the restore set the incoming user as owner.

#### Scenario: Two accounts on one device, second has no archive

- **WHEN** user B signs in over user A's local data and B has no archive
- **THEN** A's state is archived and removed, and sync status has B as owner with null cursors

#### Scenario: Returning account

- **WHEN** user B signs in and an archive for B exists
- **THEN** B's keys and cursors are restored and the archive is removed

#### Scenario: Archive write fails

- **WHEN** archiving the outgoing user throws
- **THEN** the guard continues and still wipes local state and sets the incoming owner

#### Scenario: Device settings

- **WHEN** a switch happens
- **THEN** the superuser keys, `client-salt`, the Pokédex sort and other listed device-level keys stay

Source: `lib/sync/guardAccountSwitch.ts:66-102`, `lib/sync/guardAccountSwitch.ts:109-177`,
`lib/storage/userArchive.ts:90-132`, `lib/storage/userArchive.ts:145-192`; tests
`lib/sync/guardAccountSwitch.test.ts:82-277`, `lib/sync/integration/account-switch.test.ts:186-247`.

### Requirement: Cloud deletion removes the identity (baseline, current behaviour)

`deleteAccount` SHALL call the `delete_account` RPC and return true or false, logging failures and
never throwing. The RPC SHALL delete `auth.users` for `auth.uid()` only, raise when there is no
session, and be executable by `authenticated` alone. `card_reviews`, `streak_days`, `user_settings`,
`grade_log`, `push_subscriptions`, `feedback` and `usernames` rows SHALL go through
`ON DELETE CASCADE`. There is no database test of this RPC (#2210).

#### Scenario: RPC error

- **WHEN** the RPC returns an error
- **THEN** `deleteAccount` logs it and returns false

Source: `lib/sync/deleteAccount.ts:18-30`, `db/migrations/027_delete_account_rpc.sql:40-62`,
`db/migrations/001_initial_sync_schema.sql:7`, `db/migrations/001_initial_sync_schema.sql:39`,
`db/migrations/001_initial_sync_schema.sql:61`, `db/migrations/006_grade_log.sql:13`,
`db/migrations/028_web_push_subscriptions.sql:80`, `db/migrations/034_feedback.sql:17`,
`db/migrations/035_usernames.sql:24`; tests `lib/sync/deleteAccount.test.ts:32-57`.

### Requirement: Account deletion clears the cloud first, then the device (baseline, current behaviour)

`deleteAccountEverywhere` SHALL delete the cloud account first and return
`cloud-delete-failed` with local data untouched if that fails. On success it SHALL run
`clearLocalProgress`, which deletes the IndexedDB review session, grade log and migration flag, then
remove every `poke-memory:*` localStorage key on the device, including settings, superuser keys and
every `user-archive:*` key of any account, and leave other keys alone. The IndexedDB copy of the
pending-grade queue SHALL stay (#2211).

#### Scenario: Offline

- **WHEN** the cloud delete fails
- **THEN** no local data is cleared

#### Scenario: Shared device

- **WHEN** player A deletes their account on a device holding player B's archive
- **THEN** B's archive is removed too

Source: `lib/sync/deleteAccount.ts:41-57`, `lib/sync/deleteAccount.ts:77-88`,
`lib/storage/reset.ts:18-53`; tests `lib/sync/deleteAccount.test.ts:82-100`,
`components/settings/deleteAccount-local.test.tsx:59-77`.

### Requirement: Deleting needs a typed confirmation (baseline, current behaviour)

The dialog SHALL enable "Delete account" only when the input is exactly `DELETE`. Settings SHALL
disable the entry point while a superuser flag is on and return early if called anyway. On success it
SHALL clear the favourite and call `signOut`. On failure it SHALL show "Could not delete your
account. Check your connection and try again." in the dialog and re-enable it.

#### Scenario: Lowercase word

- **WHEN** the player types `delete`
- **THEN** the button stays disabled

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the delete entry point is disabled

Source: `components/settings/DeleteAccountDialog.tsx:51-65`, `components/settings/DeleteAccountDialog.tsx:115-122`,
`app/settings/page.tsx:691-702`, `app/settings/page.tsx:2263-2300`; tests
`components/settings/DeleteAccountDialog.test.tsx`.

### Requirement: Guests get a per-device shuffle salt (baseline, current behaviour)

The review shuffle SHALL use `user.id` for a signed-in user and otherwise `getOrCreateClientSalt`,
which SHALL return the stored value, or create and store a UUID. It SHALL return an empty string
outside a browser. If the write fails the value SHALL last for the session only.

#### Scenario: Second call

- **WHEN** a salt is already stored
- **THEN** the same value is returned

#### Scenario: No window

- **WHEN** there is no `window`
- **THEN** the result is an empty string

Source: `lib/identity/clientSalt.ts:17-32`, `components/review/ReviewSession.tsx:1148`; tests
`components/identity/clientSalt.test.tsx`.
