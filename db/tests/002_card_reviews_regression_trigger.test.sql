-- Trigger test probes for migration 002_card_reviews_regression_trigger.
--
-- This is a manual probe script today. Run with psql against a database
-- that has migrations 001 and 002 applied. Each probe is independent; run
-- them in order. A future follow-up (see issue tracker) wires this into CI
-- so the trigger cannot be silently dropped by a later migration.
--
-- Usage:
--   PGURL=postgres://postgres:password@localhost:54322/postgres
--   psql "$PGURL" -v ON_ERROR_STOP=0 -f db/tests/002_card_reviews_regression_trigger.test.sql
--
-- A test user must exist in auth.users. Replace the placeholder UUID with a
-- real user_id before running. The probe pokemon_id (999999) is chosen to
-- sit outside the standard Pokédex range (1-1025) and below the evolution
-- offset (1_000_001) so it cannot collide with real card rows.

\set test_user_id '\'00000000-0000-0000-0000-000000000000\''
\set probe_pokemon_id 999999

BEGIN;

-- Setup: a row representing a reviewed, seen card.
INSERT INTO card_reviews
  (user_id, pokemon_id, last_review, first_seen, repetitions, interval, ease_factor, due_date)
VALUES
  (:test_user_id::uuid, :probe_pokemon_id, '2026-05-10'::date, '2026-05-09'::date, 3, 6, 2.5, '2026-05-16'::date);

-- Probe A: un-review a reviewed card. Expect: ERROR 23514, "last_review cannot transition ... to NULL".
SAVEPOINT probe_a;
UPDATE card_reviews SET last_review = NULL WHERE pokemon_id = :probe_pokemon_id;
ROLLBACK TO SAVEPOINT probe_a;

-- Probe B: un-see a seen card. Expect: ERROR 23514, "first_seen cannot transition ... to NULL".
SAVEPOINT probe_b;
UPDATE card_reviews SET first_seen = NULL WHERE pokemon_id = :probe_pokemon_id;
ROLLBACK TO SAVEPOINT probe_b;

-- Probe C: move review date backward. Expect: ERROR 23514, "last_review cannot move backward".
SAVEPOINT probe_c;
UPDATE card_reviews SET last_review = '2026-04-01'::date WHERE pokemon_id = :probe_pokemon_id;
ROLLBACK TO SAVEPOINT probe_c;

-- Probe D: legitimate SM-2 "Again" regrade — repetitions drops to 0 and ease decreases,
-- but last_review moves forward. Expect: success.
UPDATE card_reviews
SET repetitions = 0,
    interval    = 1,
    ease_factor = 2.30,
    last_review = CURRENT_DATE,
    due_date    = CURRENT_DATE + 1
WHERE pokemon_id = :probe_pokemon_id;

-- Discard all probe state.
ROLLBACK;
