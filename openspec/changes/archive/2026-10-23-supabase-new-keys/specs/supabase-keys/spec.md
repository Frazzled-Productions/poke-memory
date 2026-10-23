## Purpose

Which Supabase API key each part of Poké Memory uses: the low-privilege key for the browser and
server clients (row-level security applies) and the secret key for the server routes that bypass it.
The baseline (current behaviour before this change) is that both read only the legacy keys; this
change adds the new keys with the legacy ones as a fallback (#2162).

## ADDED Requirements

### Requirement: A missing key stops the client (baseline, current behaviour)

The browser Supabase client SHALL throw "Supabase env vars not configured" when it has no URL or no
low-privilege key. A server route that needs the secret key and finds none SHALL answer with its
existing misconfigured response (500 for feedback, 503 for the push routes) and SHALL NOT call
Supabase.

#### Scenario: No low-privilege key at all

- **WHEN** neither `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` nor `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set
- **THEN** creating the browser client throws "Supabase env vars not configured"

#### Scenario: No secret key at all

- **WHEN** neither `SUPABASE_SECRET_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` is set and the feedback route is called
- **THEN** it answers 500 `misconfigured` and writes nothing

### Requirement: The publishable key wins, the legacy anon key is the fallback

The browser and server Supabase clients SHALL use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` when it is
set and not empty, and SHALL otherwise use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

#### Scenario: Both keys set

- **WHEN** both the publishable and the legacy anon key are set
- **THEN** the browser and server clients are created with the publishable key

#### Scenario: Only the legacy anon key set

- **WHEN** only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set (production before the env change)
- **THEN** the browser and server clients are created with the legacy anon key, as before

### Requirement: The secret key wins, the legacy service_role key is the fallback

The Discord digest and notify, feedback, push send-daily and push send-streak-nudge routes SHALL use
`SUPABASE_SECRET_KEY` when it is set and not empty, and SHALL otherwise use
`SUPABASE_SERVICE_ROLE_KEY`.

#### Scenario: Both keys set

- **WHEN** both `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set
- **THEN** the routes use `SUPABASE_SECRET_KEY`

#### Scenario: Only the legacy service_role key set

- **WHEN** only `SUPABASE_SERVICE_ROLE_KEY` is set
- **THEN** the routes use it, as before

#### Scenario: The new key is set but empty

- **WHEN** `SUPABASE_SECRET_KEY` is an empty string and `SUPABASE_SERVICE_ROLE_KEY` is set
- **THEN** the routes use `SUPABASE_SERVICE_ROLE_KEY`
