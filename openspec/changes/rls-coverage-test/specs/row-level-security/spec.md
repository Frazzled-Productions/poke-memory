## Purpose
How Poké Memory keeps each user's rows from every other user. `anon` and `authenticated` hold every
privilege on every `public` table, so Row Level Security is the only barrier. The baseline
requirements describe `db/migrations/` as they stand on `qa` and on both live projects (read
2 November 2026); the last requirement is new in this change (#2212).

## ADDED Requirements

### Requirement: Every public table has RLS on (baseline, current behaviour)

Every table in the `public` schema SHALL have Row Level Security enabled by a migration, and SHALL
have at least one policy, except `rate_limit_buckets`, which has RLS on and no policy because it is
reached only through a SECURITY DEFINER function.

#### Scenario: The migrated schema

- **WHEN** all migrations have run
- **THEN** all 8 `public` tables have `relrowsecurity` true, and all but `rate_limit_buckets` have a policy

#### Scenario: Allowlisted table with RLS off

- **WHEN** RLS is off on `rate_limit_buckets`
- **THEN** that is a gap; the allowlist excuses the policy rule only

### Requirement: Signed-in users reach only their own rows (baseline, current behaviour)

On `card_reviews`, `grade_log`, `push_subscriptions`, `streak_days`, `user_settings`, `feedback` and
`usernames`, a signed-in user SHALL NOT read another user's row, insert a row carrying another
user's id, or update another user's row. A user SHALL NOT hand their own row to another user.

#### Scenario: Read another user's row

- **WHEN** user A selects rows belonging to user B
- **THEN** no row comes back and no error is raised

#### Scenario: Insert for another user

- **WHEN** user A inserts a row with user B's id
- **THEN** the insert fails with a row-level security error

#### Scenario: Blind update

- **WHEN** user A runs an UPDATE with no `WHERE`
- **THEN** only rows user A owns on `card_reviews` and `user_settings` change, and no row changes on any other table

#### Scenario: Hand a row over

- **WHEN** user A sets `user_id` on their own `card_reviews` or `user_settings` row to user B
- **THEN** the update fails with a row-level security error

### Requirement: Owners read their own rows, except where no client read exists (baseline, current behaviour)

A signed-in user SHALL be able to read their own rows on `card_reviews`, `grade_log`,
`push_subscriptions`, `streak_days` and `user_settings`. No client SHALL read `feedback` or
`usernames`, the owner included.

#### Scenario: Owner reads a sync table

- **WHEN** user B selects their own `grade_log` row
- **THEN** the row comes back

#### Scenario: Owner reads feedback

- **WHEN** user B selects their own `feedback` row
- **THEN** no row comes back

### Requirement: Anon reads nothing (baseline, current behaviour)

A request with only the public key SHALL NOT read a row from any user table.

#### Scenario: Anon selects

- **WHEN** `anon` selects from `grade_log` with rows present
- **THEN** no row comes back

### Requirement: CI fails a table that breaks these rules

`lib/sync/integration/rls-coverage.test.ts` SHALL fail when a `public` table has RLS off, has no
policy and is not allowlisted, or is listed neither as a user table nor on the allowlist. The
check SHALL read the migrated schema itself, so it does not rely on the live auto-enable trigger.

#### Scenario: New table without RLS

- **WHEN** a migration adds a `public` table without `ENABLE ROW LEVEL SECURITY`
- **THEN** the `integration` job fails and names the table

#### Scenario: New table with RLS and a policy

- **WHEN** a migration adds a correct `public` table but the test does not list it
- **THEN** the `integration` job fails until the table has a row in the test

#### Scenario: The check itself

- **WHEN** bad tables are created in a rolled-back transaction
- **THEN** the catalogue check reports each one, so it cannot pass by finding nothing
