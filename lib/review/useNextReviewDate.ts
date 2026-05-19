"use client";

import { useState, useEffect } from "react";
import { loadSession } from "@/lib/review/persistence";
import { loadSettings } from "@/lib/settings/persistence";
import { todayInTimezone, detectTimezone } from "@/lib/utils/format-date";
import type { ReviewableCard } from "@/lib/review/session";
import type { EvolutionReviewCard, ReverseEvolutionReviewCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The resolved next-review information for a species. */
export type NextReviewInfo =
  | { status: "pending" }           // hydration not yet complete
  | { status: "not-started" }       // no card for this species has been graded yet
  | { status: "due-today" }         // earliest due card is due today or overdue
  | { status: "due-in"; days: number }; // earliest due card is N days away

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Returns true when the card belongs to the given species. */
export function cardBelongsToSpecies(
  card: ReviewableCard,
  speciesId: number,
): boolean {
  switch (card.cardType) {
    case "name":
      return card.id === speciesId;
    case "reverse":
    case "cry":
      return card.pokemonId === speciesId;
    case "evolution":
    case "reverse-evolution": {
      const evoCard = card as EvolutionReviewCard | ReverseEvolutionReviewCard;
      return evoCard.preEvoId === speciesId || evoCard.postEvoId === speciesId;
    }
    default:
      return false;
  }
}

/**
 * Computes the next-review info for a species from a flat list of cards.
 *
 * Only cards that have been started (lastReview !== null) contribute.
 * The soonest dueDate across all started cards for the species determines
 * the status.
 *
 * `todayIso` must be a YYYY-MM-DD string in the user's timezone.
 */
export function computeNextReview(
  cards: readonly ReviewableCard[],
  speciesId: number,
  todayIso: string,
): Exclude<NextReviewInfo, { status: "pending" }> {
  const relevant = cards.filter(
    (c) => cardBelongsToSpecies(c, speciesId) && c.state.lastReview !== null,
  );

  if (relevant.length === 0) {
    return { status: "not-started" };
  }

  // Find the earliest dueDate among started cards. String comparison is safe
  // for YYYY-MM-DD strings — lexicographic order matches calendar order.
  const earliest = relevant.reduce((min, c) =>
    c.state.dueDate < min ? c.state.dueDate : min,
    relevant[0].state.dueDate,
  );

  if (earliest <= todayIso) {
    return { status: "due-today" };
  }

  // Count calendar days between today and the due date.
  // Both strings are YYYY-MM-DD; parse at noon UTC to avoid DST ambiguity.
  const todayMs = new Date(todayIso + "T12:00:00Z").getTime();
  const dueMs = new Date(earliest + "T12:00:00Z").getTime();
  const days = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  return { status: "due-in", days };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the next-review status for a given species (by its SeedPokemon id).
 *
 * - "pending" while IndexedDB is loading.
 * - "not-started" when no card for this species has been graded yet.
 * - "due-today" when the earliest due card is due today or overdue.
 * - "due-in" when the earliest due card is N days away.
 *
 * Timezone is read from user settings (falling back to the browser default
 * via detectTimezone()) so "due today" aligns with the user's clock.
 */
export function useNextReviewDate(speciesId: number): NextReviewInfo {
  const [info, setInfo] = useState<NextReviewInfo>({ status: "pending" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [session, settings] = await Promise.all([
        loadSession(),
        Promise.resolve(loadSettings()),
      ]);

      if (cancelled) return;

      if (session === null) {
        setInfo({ status: "not-started" });
        return;
      }

      const tz = settings.timezone ?? detectTimezone();
      const todayIso = todayInTimezone(tz);
      const result = computeNextReview(session.cards, speciesId, todayIso);
      setInfo(result);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [speciesId]);

  return info;
}
