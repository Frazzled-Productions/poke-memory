## MODIFIED Requirements

### Requirement: A missing key stops the client (baseline, current behaviour)

The browser Supabase client SHALL throw "Supabase env vars not configured" when it has no URL or no
low-privilege key. A server route that needs the secret key and finds none SHALL answer with its
existing misconfigured response (500 for feedback, 503 for the push routes) and SHALL NOT call
Supabase. Username sign-up, which also needs the secret key, SHALL answer `signup_failed` and SHALL
NOT create an account.

#### Scenario: No low-privilege key at all

- **WHEN** neither `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` nor `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set
- **THEN** creating the browser client throws "Supabase env vars not configured"

#### Scenario: No secret key at all

- **WHEN** neither `SUPABASE_SECRET_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` is set and the feedback route is called
- **THEN** it answers 500 `misconfigured` and writes nothing

#### Scenario: No secret key for username sign-up

- **WHEN** neither `SUPABASE_SECRET_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` is set and username sign-up is called
- **THEN** it answers `signup_failed` and creates no account

## ADDED Requirements

### Requirement: Username sign-up reads the secret key the same way

The username sign-up action SHALL read its key through `supabaseSecretKey()`, so `SUPABASE_SECRET_KEY`
wins when it is set and not empty, and `SUPABASE_SERVICE_ROLE_KEY` is the fallback, as for the routes.

#### Scenario: Only the legacy service_role key set

- **WHEN** only `SUPABASE_SERVICE_ROLE_KEY` is set and username sign-up is called
- **THEN** the action creates the account with that key
