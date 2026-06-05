"use client";
import { useState, useEffect } from "react";
import { loadSession } from "@/lib/review/persistence";
import { loadSettings } from "@/lib/settings/persistence";
import { classifyCard, isMastered } from "@/lib/stats/derive";
import type { CardClass } from "@/lib/stats/derive";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";

/** "pending" = hydration not yet complete; CardClass = resolved. */
export type CardClassOrPending = CardClass | "pending";

/**
 * Derive the card class (locked / learning / mastered) for a given Pokémon ID,
 * using species-level mastery: a tile shows "mastered" only when BOTH the name
 * card AND the paired reverse card have cleared the FSRS gate (#1448/#1234).
 * This matches the Pasture and Badges surfaces.
 */
export function useCardClass(id: number): CardClassOrPending {
  const [cardClass, setCardClass] = useState<CardClassOrPending>("pending");

  useEffect(() => {
    async function load() {
      const session = await loadSession();
      if (session === null) {
        setCardClass("locked");
        return;
      }
      const { masteryRepetitions } = loadSettings();
      const nameCard = session.cards.find((c) => c.id === id && c.cardType === "name");
      if (nameCard === undefined) {
        setCardClass("locked");
        return;
      }

      // Species-level mastery: the name card AND the paired reverse card must
      // both have cleared the FSRS gate before the tile shows "mastered" (#1448).
      const nameClass = classifyCard(nameCard, masteryRepetitions);
      if (nameClass !== "mastered") {
        // Either locked or learning - no need to check the reverse leg.
        setCardClass(nameClass);
        return;
      }

      // Name card is individually mastered - check the reverse leg.
      const reverseId = REVERSE_ID_OFFSET + id;
      const reverseCard = session.cards.find(
        (c) => c.id === reverseId && c.cardType === "reverse",
      );
      if (reverseCard !== undefined && isMastered(reverseCard.state, masteryRepetitions)) {
        setCardClass("mastered");
      } else {
        // Name card mastered but reverse is not - species not yet fully mastered.
        setCardClass("learning");
      }
    }
    void load();
  }, [id]);

  return cardClass;
}
