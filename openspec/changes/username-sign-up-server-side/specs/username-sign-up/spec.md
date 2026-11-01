# username-sign-up

## Purpose

How someone creates a Poké Memory account with a username and password: validation, the per-IP limit,
account creation on the server, the first sign-in and the `usernames` row.

## ADDED Requirements

### Requirement: Input is validated before anything else (baseline, current behaviour)

`signUpWithUsername` SHALL normalise the username, and SHALL reject an invalid username or a password
under `MIN_PASSWORD_LENGTH` without creating an account.

#### Scenario: Password too short

- **WHEN** the password is shorter than `MIN_PASSWORD_LENGTH`
- **THEN** the result is `password_too_short` and no account is created

#### Scenario: Mixed-case username

- **WHEN** the username is `Trainer99`
- **THEN** the account is created for the synthetic email of `trainer99`

### Requirement: Sign-up is rate limited per IP (baseline, current behaviour)

`signUpWithUsername` SHALL call `check_rate_limit` with action `signup` first, and SHALL fail closed.

#### Scenario: Limit reached

- **WHEN** the RPC returns false or an error
- **THEN** the result is `rate_limited` and no account is created

### Requirement: Accounts are created on the server, already confirmed

`signUpWithUsername` SHALL create the account with `admin.createUser` and `email_confirm: true`, and
SHALL NOT call the public `signUp`, so the result does not depend on the "Confirm email" setting.

#### Scenario: Setting off

- **WHEN** a valid sign-up runs with "Confirm email" off
- **THEN** the account is created, signed in and given a `usernames` row, and the result is ok

#### Scenario: Setting on

- **WHEN** a valid sign-up runs with "Confirm email" on
- **THEN** the account is created, signed in and given a `usernames` row, and the result is ok

#### Scenario: No secret key

- **WHEN** neither secret key is set
- **THEN** the result is `signup_failed` and no account is created

#### Scenario: Username taken

- **WHEN** `admin.createUser` answers `email_exists`
- **THEN** the result is `username_taken`

### Requirement: A new account signs in straight away

After creation, `signUpWithUsername` SHALL call `signInWithPassword` on the server client before
inserting the `usernames` row, and SHALL delete the new user if no session results.

#### Scenario: Follow-up sign-in fails

- **WHEN** `signInWithPassword` returns an error or no session
- **THEN** the result is `signup_failed`, the new user is deleted and no `usernames` row is written

### Requirement: The username row is written as the signed-in user (baseline, current behaviour)

`signUpWithUsername` SHALL insert the `usernames` row through the RLS-bound server client. A unique
violation SHALL answer `username_taken` and any other insert error SHALL answer `signup_failed`.

#### Scenario: Unique violation

- **WHEN** the insert returns code `23505`
- **THEN** the result is `username_taken`

### Requirement: Credentials never leave the action (baseline, current behaviour)

`signUpWithUsername` SHALL NOT include the password or the synthetic email in its result, on any path.

#### Scenario: Error result

- **WHEN** sign-up fails
- **THEN** the result contains neither the password nor the synthetic email
