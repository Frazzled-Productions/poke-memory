## MODIFIED Requirements

### Requirement: The secret key wins, the legacy service_role key is the fallback

The Discord digest, feedback, push send-daily and push send-streak-nudge routes SHALL use
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
