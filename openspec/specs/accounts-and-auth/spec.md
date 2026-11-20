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

### Requirement: A username maps to a synthetic email (baseline, current behaviour)

The Auth login identifier for a username account SHALL be
`<normalised username>@users.noreply.pokememory.internal`, and neither action's result SHALL contain
that address or the password.

#### Scenario: Same username twice

- **WHEN** the same normalised username is derived twice
- **THEN** both produce the same address

Source: `lib/auth/username.ts:21`, `lib/auth/username.ts:84-86`, `lib/auth/actions.ts:85`,
`lib/auth/actions.ts:208`; tests `lib/auth/actions.test.ts:121-140`, `lib/auth/username.test.ts:147-167`.

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

### Requirement: Account deletion clears the cloud first, then the device (baseline, current behaviour)

`deleteAccountEverywhere` SHALL delete the cloud account first and return
`cloud-delete-failed` with local data untouched if that fails. On success it SHALL run
`clearLocalProgress`, which deletes the IndexedDB review session, grade log, migration flag and
pending-grade queue, then remove every `poke-memory:*` localStorage key on the device, including
settings, superuser keys and every `user-archive:*` key of any account, and leave other keys alone.

#### Scenario: Offline

- **WHEN** the cloud delete fails
- **THEN** no local data is cleared, and the pending-grade queue stays in both localStorage and IndexedDB

#### Scenario: Shared device

- **WHEN** player A deletes their account on a device holding player B's archive
- **THEN** B's archive is removed too

#### Scenario: Queued grades at a delete

- **WHEN** grades are queued and the cloud delete succeeds
- **THEN** the queue is in neither localStorage nor IndexedDB

Source: `lib/sync/deleteAccount.ts:41-57`, `lib/sync/deleteAccount.ts:77-88`,
`lib/storage/reset.ts:22-58`; tests `lib/sync/deleteAccount.test.ts:82-100`,
`components/settings/deleteAccount-local.test.tsx:59-77`, `lib/storage/reset.test.ts`
("deleteAccountEverywhere clears the IDB pending-grade queue", "keeps the IDB pending-grade queue
when the cloud delete fails").

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
