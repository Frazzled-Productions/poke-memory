-- Migration 043: Add BEFORE UPDATE trigger to stamp updated_at with server
-- time on card_reviews.
--
-- Previously pushSingleCard and pushSession set updated_at from new Date() on
-- the client, overriding the column DEFAULT now() for inserts and defeating
-- the lastPullAt clock-skew anchor documented in docs/sync.md. A device with a
-- drifted clock dragged every other device's lastPullAt into the future,
-- causing background pulls to become silent no-ops.
--
-- Fix: a BEFORE UPDATE trigger sets updated_at = now() unconditionally, so the
-- value is always a server-authoritative timestamp regardless of what the client
-- sends. INSERT already has DEFAULT now() (migration 001) and is unaffected.
-- The client-side push paths drop updated_at from their upsert payloads
-- entirely; the trigger (UPDATE) and DEFAULT (INSERT) cover both cases.
--
-- Trigger firing order is alphabetical:
--   card_reviews_reject_regression_trigger  (migration 002 / 015 / 016 / 017)
--   card_reviews_set_updated_at_trigger     (this migration)
-- The regression trigger fires first (reject), then the stamp trigger (fires
-- only when the UPDATE is accepted). The regression trigger never reads
-- updated_at, so ordering is safe.

CREATE OR REPLACE FUNCTION card_reviews_set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS card_reviews_set_updated_at_trigger ON card_reviews;

CREATE TRIGGER card_reviews_set_updated_at_trigger
  BEFORE UPDATE ON card_reviews
  FOR EACH ROW
  EXECUTE FUNCTION card_reviews_set_updated_at();
