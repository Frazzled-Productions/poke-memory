"use client";

import { useEffect, useState, useCallback } from "react";
import { loadSession, saveSession } from "@/lib/review/persistence";
import type { SavedSession } from "@/lib/review/persistence";
import { filterMastered, markSeenInPasture } from "@/lib/pasture/arrivals";
import { HABITAT_ZONES } from "@/lib/pasture/zones";
import { assignAnchors } from "@/lib/pasture/assign";
import { PastureZone } from "@/components/pasture/PastureZone";
import { pushSingleCard } from "@/lib/sync/cloud";
import { useAuth } from "@/lib/auth/AuthContext";
import type { NameReviewCard } from "@/lib/review/session";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";

type Placement = {
  card: NameReviewCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

type ZoneData = {
  habitat: string;
  label: string;
  placements: Placement[];
};

/**
 * Groups mastered name-cards by habitat and assigns anchor positions.
 * Zones with zero mastered cards are omitted.
 */
function buildZoneData(masteredCards: NameReviewCard[]): ZoneData[] {
  const byHabitat = new Map<string, NameReviewCard[]>();

  for (const card of masteredCards) {
    const habitat = card.habitat ?? "unknown";
    const bucket = byHabitat.get(habitat);
    if (bucket) {
      bucket.push(card);
    } else {
      byHabitat.set(habitat, [card]);
    }
  }

  const result: ZoneData[] = [];

  for (const zone of HABITAT_ZONES) {
    const cards = byHabitat.get(zone.habitat);
    if (!cards || cards.length === 0) continue;

    const assignments = assignAnchors(cards, zone);
    const placements: Placement[] = assignments.map((a) => ({
      // assignAnchors accepts ReviewableCard but we only pass NameReviewCards
      card: a.card as NameReviewCard,
      subRegion: a.subRegion,
      anchor: a.anchor,
    }));

    result.push({
      habitat: zone.habitat,
      label: zone.label,
      placements,
    });
  }

  return result;
}

export default function PasturePage() {
  const { user, supabase } = useAuth();
  const [session, setSession] = useState<SavedSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const s = loadSession();
    setSession(s);
    setLoaded(true);
  }, []);

  const handleMarkSeen = useCallback(
    async (cardId: number) => {
      if (!session) return;

      const partialUpdated = markSeenInPasture(cardId, session);
      const updated: SavedSession = { ...session, cards: partialUpdated.cards };
      saveSession(updated);
      setSession(updated);

      // Fire-and-forget cloud sync for authenticated users
      if (supabase && user?.id) {
        const updatedCard = updated.cards.find((c) => c.id === cardId);
        if (updatedCard) {
          try {
            await pushSingleCard(supabase, user.id, updatedCard);
          } catch (err) {
            console.warn("[pasture] pushSingleCard failed:", err);
          }
        }
      }
    },
    [session, supabase, user?.id],
  );

  if (!loaded) {
    // Render nothing until the client reads localStorage — avoids a flash of
    // the empty state on first paint for users who have mastered cards.
    return null;
  }

  const masteredCards = session
    ? (filterMastered(session.cards) as NameReviewCard[])
    : [];

  if (masteredCards.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Pasture
        </h1>
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          Your pasture is empty — master your first Pokémon in Practice to see
          it here.
        </p>
      </main>
    );
  }

  const zones = buildZoneData(masteredCards);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">
        Pasture
        <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
          {masteredCards.length} Pokémon
        </span>
      </h1>

      <div className="flex flex-col gap-8">
        {zones.map((zone) => (
          <PastureZone
            key={zone.habitat}
            zone={HABITAT_ZONES.find((z) => z.habitat === zone.habitat)!}
            placements={zone.placements}
            onMarkSeen={handleMarkSeen}
          />
        ))}
      </div>
    </main>
  );
}
