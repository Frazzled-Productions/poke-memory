"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { loadSession } from "@/lib/review/persistence";
import { filterMastered } from "@/lib/pasture/arrivals";
import { HABITAT_ZONES } from "@/lib/pasture/zones";
import { assignAnchors } from "@/lib/pasture/assign";
import { PastureZone } from "@/components/pasture/PastureZone";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import type { NameReviewCard } from "@/lib/review/session";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { initialReviewState } from "@/lib/srs/scheduler";

type Placement = {
  card: NameReviewCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

/**
 * Full-screen, CSS-rotated per-biome landscape view.
 *
 * The entire viewport is rotated 90° clockwise so the biome renders in
 * landscape regardless of how the phone is held. Users can either turn
 * their phone to read naturally, or enjoy the sideways view. The scrolling
 * axis flips (users scroll up/down to traverse what is visually left/right).
 *
 * Params are Promises in Next.js 16 — always await them.
 */
export default function BiomeLandscapePage({
  params,
}: {
  params: Promise<{ biome: string }>;
}) {
  const { biome: biomeSlug } = use(params);
  const router = useRouter();
  const { flags } = useSuperuser();
  const [masteredCards, setMasteredCards] = useState<NameReviewCard[] | null>(
    null,
  );
  const storageVersion = useSessionStorageKey();

  // Validate the biome slug against known habitats before loading anything.
  const zone = HABITAT_ZONES.find((z) => z.habitat === biomeSlug);

  useEffect(() => {
    async function load() {
      if (flags.pretendAllMastered) {
        // Superuser mode: synthesise every species as mastered.
        // seenInPasture forced true so synthesised cards don't sparkle in QA.
        const all: NameReviewCard[] = SEED_POKEMON.map((p) => ({
          ...p,
          cardType: "name" as const,
          subjectKey: String(p.id),
          state: { ...initialReviewState(new Date()), seenInPasture: true },
        }));
        setMasteredCards(all);
      } else {
        const session = await loadSession();
        const cards = session
          ? (filterMastered(session.cards, false) as NameReviewCard[])
          : [];
        setMasteredCards(cards);
      }
    }
    void load();
  }, [storageVersion, flags.pretendAllMastered]);

  // Not a recognised habitat — render a 404.
  if (!zone) return notFound();

  // Still loading from localStorage — render nothing to avoid flash.
  if (masteredCards === null) return null;

  // Filter to just this biome's cards.
  const biomeCards = masteredCards.filter(
    (c) => (c.habitat ?? "unknown") === biomeSlug,
  );

  // Build placements exactly as the main Pasture page does.
  const assignments = assignAnchors(biomeCards, zone);
  const placements: Placement[] = assignments.map((a) => ({
    card: a.card as NameReviewCard,
    subRegion: a.subRegion,
    anchor: a.anchor,
  }));

  const isEmpty = biomeCards.length === 0;

  return (
    /*
     * Outer wrapper: fixed to the full viewport, clipped so the rotated
     * content doesn't overflow and cause scrollbars outside the rotated axis.
     */
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/*
       * Inner wrapper: rotated 90° clockwise and re-sized so the content fills
       * the viewport in landscape orientation.
       *
       * After a 90° CW rotation, the element's width maps to viewport height
       * and vice-versa, so we set w = 100dvh and h = 100dvw. The translate
       * centres the rotated box inside the viewport.
       */}
      <div
        className="absolute overflow-y-auto"
        style={{
          width: "100dvh",
          height: "100dvw",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(90deg)",
          transformOrigin: "center center",
        }}
      >
        {/* Back button — top-left in the rotated (landscape) frame */}
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-background/90 px-4 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back to Pasture"
            className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                d="M10 3L5 8L10 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Pasture
          </button>
          <h1 className="ml-1 text-sm font-semibold text-foreground">
            {zone.label}
            <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">
              ({biomeCards.length})
            </span>
          </h1>
        </div>

        <main className="px-4 pb-8 pt-2">
          {isEmpty ? (
            <p className="mt-6 text-zinc-500 dark:text-zinc-400">
              No mastered Pokémon in this biome yet — keep practising!
            </p>
          ) : (
            <PastureZone
              zone={zone}
              placements={placements}
              onMarkSeen={() => {
                /* read-only in landscape view — sparkle clears on the main Pasture page */
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
