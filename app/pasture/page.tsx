"use client";

import { useEffect, useState, useCallback } from "react";
import { loadSession, saveSession } from "@/lib/review/persistence";
import type { SavedSession } from "@/lib/review/persistence";
import { filterMastered, markSeenInPasture } from "@/lib/pasture/arrivals";
import { HABITAT_ZONES } from "@/lib/pasture/zones";
import { assignAnchors } from "@/lib/pasture/assign";
import { biomeStats } from "@/lib/pasture/stats";
import type { BiomeStats } from "@/lib/pasture/stats";
import { PastureZone } from "@/components/pasture/PastureZone";
import { PastureSearchBar } from "@/components/pasture/PastureSearchBar";
import { pushSingleCard } from "@/lib/sync/cloud";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSessionStorageKey } from "@/lib/review/useSessionStorageKey";
import type { NameReviewCard } from "@/lib/review/session";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { initialReviewState } from "@/lib/srs/scheduler";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

type Placement = {
  card: NameReviewCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

type ZoneData = {
  habitat: string;
  label: string;
  placements: Placement[];
  stats: BiomeStats;
};

/**
 * Groups mastered name-cards by habitat and assigns anchor positions.
 * Zones with zero mastered cards are omitted.
 *
 * Stats are computed against `allMasteredCards` (the full mastered set, not
 * the search-filtered subset) so that the % captured and latest-addition
 * figures always reflect the user's true progress regardless of active search.
 */
function buildZoneData(
  visibleCards: NameReviewCard[],
  allMasteredCards: NameReviewCard[],
  forceAllMastered: boolean,
): ZoneData[] {
  const byHabitat = new Map<string, NameReviewCard[]>();

  for (const card of visibleCards) {
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
      stats: biomeStats(zone.habitat, allMasteredCards, forceAllMastered),
    });
  }

  return result;
}

export default function PasturePage() {
  const { user, supabase } = useAuth();
  const { flags } = useSuperuser();
  const [session, setSession] = useState<SavedSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Re-load when the session localStorage key changes (post-grade sync, post-reset
  // via clearLocalProgress). Matches the pattern used by Stats and Pokédex; without
  // this, a reset that does not navigate away from /pasture would leave stale state.
  const storageVersion = useSessionStorageKey();
  // Re-render when the user saves Settings, so a change to the
  // masteryRepetitions threshold re-filters the pasture without needing a
  // session storage bump or a navigation away and back.
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    function onSaved() {
      setSettingsVersion((v) => v + 1);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  useEffect(() => {
    async function load() {
      const s = await loadSession();
      setSession(s);
      setLoaded(true);
    }
    void load();
  }, [storageVersion]);

  // The user's configured mastery threshold. loadSettings is synchronous and
  // reads localStorage, so it is safe to call directly in render; it falls
  // back to the default when no settings blob has been written. Reading
  // `settingsVersion` here ties the value to the SETTINGS_SAVED_EVENT bump so
  // a threshold change re-derives the filtered pasture immediately.
  void settingsVersion;
  const masteryRepetitions = loadSettings().masteryRepetitions;

  // Derive mastered count so the reset-on-empty effect below can read it
  // without duplicating the full derivation logic.
  const masteredCount = !loaded
    ? null
    : flags.pretendAllMastered
      ? SEED_POKEMON.length
      : session
        ? filterMastered(session.cards, false, masteryRepetitions).length
        : 0;

  // Reset the search query whenever the mastered set transitions to empty
  // (e.g. storage clear, sign-out triggering a reload). Guard on `loaded` so
  // we never clear a query on the initial render before data arrives, and
  // guard on `searchQuery` so we skip the effect when there is nothing to
  // clear (avoids unnecessary state updates).
  useEffect(() => {
    if (loaded && masteredCount === 0 && searchQuery !== "") {
      setSearchQuery("");
    }
    // masteredCount and loaded are the meaningful signals; searchQuery is read
    // for the guard but should not re-trigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, masteredCount]);

  const handleMarkSeen = useCallback(
    async (cardId: number) => {
      if (!session) return;

      const partialUpdated = markSeenInPasture(cardId, session);
      const updated: SavedSession = { ...session, cards: partialUpdated.cards };
      // saveSession dispatches the synthetic StorageEvent for same-tab
      // subscribers (useSessionStorageKey).
      await saveSession(updated);
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

  // Superuser pretendAllMastered: source every species from SEED_POKEMON
  // directly so the pasture is fully populated even on a fresh or sparse
  // localStorage session. seenInPasture is forced true so the synthesized
  // cards don't sparkle as "new arrivals" in QA mode. Persisted state is left
  // untouched — markSeenInPasture is a no-op for ids not in session.cards.
  const masteredCards: NameReviewCard[] = flags.pretendAllMastered
    ? SEED_POKEMON.map((p) => ({
        ...p,
        cardType: "name" as const,
        subjectKey: String(p.id),
        state: { ...initialReviewState(new Date()), seenInPasture: true },
      }))
    : session
      ? (filterMastered(
          session.cards,
          false,
          masteryRepetitions,
        ) as NameReviewCard[])
      : [];

  if (masteredCards.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Pasture
        </h1>
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          Your pasture is empty. Master your first Pokémon in Practice to see
          it here.
        </p>
      </main>
    );
  }

  // Filter by search query — case-insensitive substring match on display name.
  const trimmed = searchQuery.trim().toLowerCase();
  const visibleCards =
    trimmed === ""
      ? masteredCards
      : masteredCards.filter((c) => c.name.toLowerCase().includes(trimmed));

  const zones = buildZoneData(visibleCards, masteredCards, flags.pretendAllMastered);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">
        Pasture
        <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
          {masteredCards.length} Pokémon
        </span>
      </h1>

      <PastureSearchBar query={searchQuery} onChange={setSearchQuery} />

      {zones.length === 0 && trimmed !== "" ? (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No Pokémon match &ldquo;{searchQuery.trim()}&rdquo;.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {zones.map((zone) => (
            <PastureZone
              key={zone.habitat}
              zone={HABITAT_ZONES.find((z) => z.habitat === zone.habitat)!}
              placements={zone.placements}
              onMarkSeen={handleMarkSeen}
              biomeHref={`/pasture/${zone.habitat}`}
              stats={zone.stats}
            />
          ))}
        </div>
      )}
    </main>
  );
}
