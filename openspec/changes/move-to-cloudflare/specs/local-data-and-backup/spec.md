## ADDED Requirements

### Requirement: The review-history CSV is for signed-in users only

`GET /api/export` SHALL answer 401 without a session, including when reading the session errors, and 503
`service_unavailable` when a D1 read fails. Settings SHALL show the download link to signed-in users
only, as a plain link with no error handling, so a failure produces no message in the app. The service
worker SHALL NOT cache it, so it needs a network connection.

#### Scenario: Guest calls the route

- **WHEN** a request arrives with no session
- **THEN** the answer is 401 and no rows are read

#### Scenario: Database read fails

- **WHEN** the `grade_log` read errors
- **THEN** the answer is 503

#### Scenario: Two users

- **WHEN** user B downloads the CSV
- **THEN** it holds only B's rows

#### Scenario: Offline

- **WHEN** a signed-in player presses the link with no connection
- **THEN** the download fails and the app shows no message

Source (planned): `app/api/export/route.ts`, `lib/auth/requireAuth.ts`, `lib/db/scope.ts`;
`app/settings/page.tsx:1939-1954`, `lib/pwa/cacheStrategy.ts:121-130`; tests
`app/api/export/route.test.tsx`, `e2e/settings.spec.ts:462`.

### Requirement: The privacy notice names Cloudflare as the place data is held

The privacy notice and terms SHALL name Cloudflare (hosting, the database in the EU, backups, page-view
analytics) where they named Supabase and Vercel, SHALL describe the scope helper where they described
row-level security, and SHALL give the new session cookie's name. Sentry's entry SHALL be unchanged.
`docs/dpia.md` and `docs/cookies-pecr.md` SHALL say the same. The notice stays English only.

#### Scenario: Reading the notice

- **WHEN** anyone opens the privacy notice
- **THEN** it names Cloudflare as host and database, and does not name Supabase or Vercel as a current processor

#### Scenario: Japanese locale

- **WHEN** the app language is `ja`
- **THEN** the notice is in English, as today

#### Scenario: Cookie section

- **WHEN** a reader looks up the sign-in cookie
- **THEN** the notice gives Better Auth's session cookie name in place of the Supabase one

Source (planned): `app/privacy/page.tsx`, `app/terms/page.tsx:119`, `docs/dpia.md`,
`docs/cookies-pecr.md`; test `app/privacy/page.test.tsx`.

## MODIFIED Requirements

### Requirement: Sign-out leaves local data on the device (baseline)

`signOut` SHALL end the session and redirect to `/`, and SHALL NOT clear local data or the recorded
owner, so the app carries on with that data as a guest and the owner stays recorded for the next sign-in.

#### Scenario: Same user returns

- **WHEN** a user signs out and the same user signs back in
- **THEN** `guardAccountSwitch` finds them as the owner and does nothing

Evidence: planned `lib/auth/actions.ts`; `components/auth/AuthButton.tsx:61`;
`lib/sync/guardAccountSwitch.ts:109-117`.

## REMOVED Requirements

### Requirement: Review-history CSV is for signed-in users (baseline)

**Reason**: It described the Supabase client (building it, re-throwing control errors while doing so,
and a Supabase read failure).

**Migration**: Replaced by "The review-history CSV is for signed-in users only", with the same 401 and
503 answers.
