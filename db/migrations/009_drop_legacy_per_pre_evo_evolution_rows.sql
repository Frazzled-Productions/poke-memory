-- Drop orphan card_reviews rows from the pre-#344 per-pre-evo evolution-card
-- scheme. That scheme used pokemon_id = species_id within
-- [1_000_001, 1_500_000] to represent "this Pokémon's evolution card."
-- #262/#344 replaced it with one card per evolution edge in
-- [1_500_001, 1_999_999]. The legacy range was reserved as "never re-issued"
-- (scripts/seed-pokemon.mjs:300-302) but the orphan rows were never deleted,
-- so previously-graded evolution cards now lack a matching local card and
-- reappear in the review queue under their new edge IDs (issue #383).
--
-- No current client code reads or writes IDs in [1_000_001, 1_500_000], so
-- deletion is safe. The BEFORE UPDATE regression trigger from migration 002
-- does not fire on DELETE.

DELETE FROM card_reviews
WHERE pokemon_id BETWEEN 1000001 AND 1500000;
