"use client";
import { useState, useEffect } from "react";
import { loadSession } from "@/lib/review/persistence";
import { classifyCard } from "@/lib/stats/derive";
import type { CardClass } from "@/lib/stats/derive";

/** "pending" = hydration not yet complete; CardClass = resolved. */
export type CardClassOrPending = CardClass | "pending";

export function useCardClass(id: number): CardClassOrPending {
  const [cardClass, setCardClass] = useState<CardClassOrPending>("pending");

  useEffect(() => {
    const session = loadSession();
    if (session === null) {
      setCardClass("locked");
      return;
    }
    const card = session.cards.find((c) => c.id === id && c.cardType === "name");
    setCardClass(card !== undefined ? classifyCard(card) : "locked");
  }, [id]);

  return cardClass;
}
