"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { loadSession } from "@/lib/review/persistence";
import { filterMastered } from "@/lib/pasture/arrivals";
import { HABITAT_ZONES } from "@/lib/pasture/zones";
import { assignAnchors } from "@/lib/pasture/assign";
import { biomeStats } from "@/lib/pasture/stats";
import { PastureZone } from "@/components/pasture/PastureZone";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import type { NameReviewCard } from "@/lib/review/session";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { initialReviewState } from "@/lib/srs/scheduler";
import { loadSettings } from "@/lib/settings/persistence";

type Placement = {
  card: NameReviewCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

/**
 * Returns true when the viewport is already in landscape orientation.
 * Listens for orientation changes live so the biome view re-renders
 * whenever the user rotates the device.
 */
function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(orientation: landscape)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    // Re-sync in case orientation changed between the lazy useState initialiser
    // (render time) and this effect running (after paint).
    setIsLandscape(mq.matches);
    function handleChange(e: MediaQueryListEvent) {
      setIsLandscape(e.matches);
    }
    mq.addEventListener("change", handleChange);
    return () => {
      mq.removeEventListener("change", handleChange);
    };
  }, []);

  return isLandscape;
}

/**
 * Full-screen per-biome landscape view.
 *
 * When the device viewport is in portrait orientation the content is rotated
 * 90° clockwise so the biome renders in landscape. When the device is already
 * in landscape the rotation is omitted — applying it would compound the OS
 * reflow and double-rotate the content, leaving it portrait-oriented inside
 * a landscape frame.
 *
 * Orientation changes are detected live via a `matchMedia` listener so the
 * layout updates without a page reload when the user rotates their device.
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
  const isLandscape = useIsLandscape();
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
        const masteryRepetitions = loadSettings().masteryRepetitions;
        const cards = session
          ? (filterMastered(
              session.cards,
              false,
              masteryRepetitions,
            ) as NameReviewCard[])
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

  // Compute biome stats. Pass `flags.pretendAllMastered` so the stats honour
  // the superuser flag; masteredCards is already the full synthesised set in
  // QA mode.
  const stats = biomeStats(biomeSlug, masteredCards, flags.pretendAllMastered);

  return (
    /*
     * Outer wrapper: fixed to the full viewport, clipped so content doesn't
     * overflow and cause scrollbars outside the intended scroll axis.
     */
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/*
       * Inner wrapper — two layout branches:
       *
       * Portrait device  → rotate 90° CW so the biome renders in landscape.
       *   After rotation the element's width maps to viewport height and
       *   vice-versa, so we set w = 100dvh and h = 100dvw. The translate
       *   centres the rotated box inside the viewport.
       *
       * Landscape device → no rotation; use natural viewport dimensions.
       *   Without this branch the OS reflow (which already puts the viewport
       *   in landscape) and the CSS rotation compound, double-rotating the
       *   content back to portrait inside the now-landscape frame.
       */}
      <div
        className="absolute overflow-y-auto"
        style={
          isLandscape
            ? {
                width: "100dvw",
                height: "100dvh",
                top: 0,
                left: 0,
              }
            : {
                width: "100dvh",
                height: "100dvw",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%) rotate(90deg)",
                transformOrigin: "center center",
              }
        }
      >
        {/* Back button + biome heading — top-left in the rotated (landscape) frame */}
        <div className="sticky top-0 z-20 bg-background/90 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // If the user arrived via a direct link or bookmark (no in-app
                // history), router.back() would leave the app or no-op. Fall back
                // to an explicit push so there is always a safe escape route.
                if (window.history.length <= 1) {
                  router.push("/pasture");
                } else {
                  router.back();
                }
              }}
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

          {/* Richer stats panel — shown below the heading row */}
          <dl
            className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400"
            aria-label="Biome statistics"
          >
            <div>
              <dt className="sr-only">Species mastered</dt>
              <dd>
                <span className="font-medium text-foreground">
                  {stats.masteredCount}
                </span>
                <span className="opacity-60"> / {stats.totalCount} species</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Captured</dt>
              <dd>
                <span className="font-medium text-foreground">
                  {stats.capturedPercent}%
                </span>
                <span className="opacity-60"> captured</span>
              </dd>
            </div>
            {stats.latestAddition !== null && (
              <div>
                <dt className="sr-only">Latest addition</dt>
                <dd>
                  <span className="opacity-60">Latest: </span>
                  <span className="font-medium text-foreground">
                    {stats.latestAddition}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <main className="px-4 pb-8 pt-2">
          {isEmpty ? (
            <p className="mt-6 text-zinc-500 dark:text-zinc-400">
              No mastered Pokémon in this biome yet. Keep practising!
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
