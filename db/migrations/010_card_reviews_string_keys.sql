-- Migration 010: Card identity refactor — (card_type, subject_key) composite key
--
-- Replaces the integer pokemon_id identity column with a string pair:
--   card_type   text  — DB discriminator: 'name' | 'reverse' | 'cry' |
--                       'evolution-edge' | 'reverse-evolution-edge'
--   subject_key text  — species ID as plain string ("1", "25"), or
--                       edge key as "fromId>>>toId" ("1>>>2")
--
-- Backfill note:
--   Existing name/reverse/cry rows: subject_key = pokemon_id::text
--   Existing evolution/reverse-evolution rows in the legacy pokemon_id range
--   (1_000_001..1_700_000) are already empty in production (migration 009 cleaned
--   them). This migration leaves those rows with subject_key = NULL; the client
--   skips NULL rows on pull. A follow-up migration (011) can drop pokemon_id
--   once all clients have shipped this build.
--
-- Conflict key: UNIQUE (user_id, card_type, subject_key) WHERE subject_key IS NOT NULL
-- The partial index avoids collisions on the legacy NULL rows.

-- 1. Add the new columns (nullable for now; backfilled below).
ALTER TABLE card_reviews
  ADD COLUMN IF NOT EXISTS card_type   text,
  ADD COLUMN IF NOT EXISTS subject_key text;

-- 2. Backfill name cards (pokemon_id 1..1_000_000).
UPDATE card_reviews
SET
  card_type   = 'name',
  subject_key = pokemon_id::text
WHERE pokemon_id BETWEEN 1 AND 1000000;

-- 3. Backfill reverse cards (pokemon_id 2_000_001..2_999_999).
UPDATE card_reviews
SET
  card_type   = 'reverse',
  subject_key = (pokemon_id - 2000000)::text
WHERE pokemon_id BETWEEN 2000001 AND 2999999;

-- 4. Backfill cry cards (pokemon_id 3_000_001..3_999_999).
UPDATE card_reviews
SET
  card_type   = 'cry',
  subject_key = (pokemon_id - 3000000)::text
WHERE pokemon_id BETWEEN 3000001 AND 3999999;

-- 5. Evolution/reverse-evolution rows in the old integer ranges are empty in
--    production (migration 009 removed them). card_type and subject_key stay
--    NULL for any orphaned rows — the client pull skips NULL subject_key rows.

-- 6. Drop the old (user_id, pokemon_id) primary key. The partial unique index
--    below becomes the de facto uniqueness check during the dual-read window.
--    We do NOT drop the pokemon_id column yet — migration 011 does that after
--    all clients have shipped this build.
--
--    Why drop the PK now: new INSERTs from the new push code carry no
--    pokemon_id (the new identity is card_type + subject_key). With the old PK
--    in place, pokemon_id would still be implicitly NOT NULL and inserts would
--    fail. Dropping the PK also removes that NOT NULL, leaving pokemon_id as a
--    nullable column that legacy/rollback paths can still read.
ALTER TABLE card_reviews DROP CONSTRAINT card_reviews_pkey;
ALTER TABLE card_reviews ALTER COLUMN pokemon_id DROP NOT NULL;

-- 7. Partial unique index: the new composite identity key.
--    Excludes rows where subject_key is NULL (legacy orphans not yet migrated).
--    A future migration 011 promotes this to a full PRIMARY KEY once all rows
--    have non-null subject_key.
CREATE UNIQUE INDEX IF NOT EXISTS card_reviews_pk_partial
  ON card_reviews (user_id, card_type, subject_key)
  WHERE subject_key IS NOT NULL;
