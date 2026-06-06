"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { loadSession, saveSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import type { SavedSession } from "@/lib/review/persistence";
import { filterMastered, markSeenInPasture } from "@/lib/pasture/arrivals";
import { nextArrivals } from "@/lib/pasture/nextArrivals";
import { NextArrivalsStrip } from "@/components/pasture/NextArrivalsStrip";
import { HABITAT_ZONES } from "@/lib/pasture/zones";
import { assignAnchors } from "@/lib/pasture/assign";
import { biomeStats } from "@/lib/pasture/stats";
import type { BiomeStats } from "@/lib/pasture/stats";
import { PastureZone } from "@/components/pasture/PastureZone";
import {
  PastureSearchBar,
  PASTURE_FILTERS_DEFAULT,
} from "@/components/pasture/PastureSearchBar";
import type { PastureFilters } from "@/components/pasture/PastureSearchBar";
import { pushSingleCard } from "@/lib/sync/cloud";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { hydrateSession } from "@/lib/review/session";
import type { NameReviewCard } from "@/lib/review/session";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { initialReviewState } from "@/lib/srs/scheduler";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { generationOf } from "@/lib/stats/derive";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { PageShell } from "@/components/ui/PageShell";
import { pageTitle } from "@/lib/utils/class-names";

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

/**
 * Applies name search, type, and generation filters to the mastered card set.
 * Stats remain computed from the full mastered set, independent of this filter.
 */
function applyFilters(
  cards: NameReviewCard[],
  filters: PastureFilters,
): NameReviewCard[] {
  return cards.filter((card) => {
    if (filters.query !== "") {
      const q = filters.query.trim().toLowerCase();
      if (!card.name.toLowerCase().includes(q)) return false;
    }

    if (filters.types.length > 0) {
      if (!filters.types.every((t) => card.types.includes(t))) return false;
    }

    if (filters.gen !== null) {
      const speciesId = card.speciesId ?? card.id;
      if (generationOf(speciesId) !== filters.gen) return false;
    }

    return true;
  });
}

/** Returns true when any filter deviates from the default (unfiltered) state. */
function isFiltered(filters: PastureFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.types.length > 0 ||
    filters.gen !== null
  );
}

export default function PasturePage() {
  const t = useTranslations("pasture");
  const { user, supabase } = useAuth();
  const { flags } = useSuperuser();
  const { seed } = useSeed();
  const [session, setSession] = useState<SavedSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<PastureFilters>(PASTURE_FILTERS_DEFAULT);
  // Re-load when the session localStorage key changes (post-grade sync, post-reset
  // via clearLocalProgress). Matches the pattern used by Stats and Pokédex; without
  // this, a reset that does not navigate away from /pasture would leave stale state.
  const storageVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
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
    if (seed === null) return; // wait for seed to load
    const currentSeed = seed; // capture non-null reference for async closure
    async function load() {
      const s = await loadSession();
      if (s) {
        // Hydrate so each card carries the full seed fields (habitat,
        // isDefaultForm, etc.) that biomeStats and buildZoneData depend on.
        // Without hydration, QA-seeded cards and any other minimal cards lack
        // those fields, causing all species to fall into the "unknown"/Wildlands
        // bucket and biomeStats to report 0 mastered per biome.
        const { pokemonNameLocale } = loadSettings();
        // All *Enabled flags are false - we only want the refresh step of
        // hydrateSession (backfill habitat, isDefaultForm, types, etc. onto
        // each saved card from the seed). Adding new cards here would bloat
        // session.cards with ~1 000 unseen species, hurting filterMastered perf.
        const { cards: hydrated, anyHealed } = hydrateSession(s.cards, currentSeed.seedPokemon, currentSeed.seedEvolutionCards, undefined, {
          reverseEnabled: false,
          nameEnabled: false,
          evolutionEnabled: false,
          reverseEvolutionEnabled: false,
          cryEnabled: false,
          // `locale` only affects newly-created cards; all *Enabled flags are
          // false here so no new cards are added. Existing saved cards keep
          // their own persisted `locale` tag unchanged. This opt is present
          // for completeness but is effectively dead in this refresh pass.
          locale: pokemonNameLocale,
        });
        // Persist healed cards so the fixed point is durable across all entry
        // points, not only Practice (#1506).
        if (anyHealed) {
          await saveSession({ cards: hydrated, limits: s.limits });
        }
        setSession({ ...s, cards: hydrated });
      } else {
        setSession(null);
      }
      setLoaded(true);
    }
    void load();
  }, [storageVersion, seed]);

  // The user's configured mastery threshold. loadSettings is synchronous and
  // reads localStorage, so it is safe to call directly in render; it falls
  // back to the default when no settings blob has been written. Reading
  // `settingsVersion` here ties the value to the SETTINGS_SAVED_EVENT bump so
  // a threshold change re-derives the filtered pasture immediately.
  void settingsVersion;
  const { masteryRepetitions, pokemonNameLocale } = loadSettings();

  // Derive mastered count so the reset-on-empty effect below can read it
  // without duplicating the full derivation logic.
  const masteredCount = !loaded
    ? null
    : flags.pretendAllMastered
      ? (seed?.seedPokemon.length ?? 0)
      : session
        ? filterMastered(session.cards, false, masteryRepetitions, pokemonNameLocale).length
        : 0;

  // Reset filters whenever the mastered set transitions to empty
  // (e.g. storage clear, sign-out triggering a reload). Guard on `loaded` so
  // we never clear filters on the initial render before data arrives, and
  // guard on `isFiltered` so we skip the effect when there is nothing to
  // clear (avoids unnecessary state updates).
  useEffect(() => {
    if (loaded && masteredCount === 0 && isFiltered(filters)) {
      setFilters(PASTURE_FILTERS_DEFAULT);
    }
    // masteredCount and loaded are the meaningful signals; filters is read
    // for the guard but should not re-trigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, masteredCount]);

  const handleQueryChange = useCallback((q: string) => {
    setFilters((prev) => ({ ...prev, query: q }));
  }, []);

  const handleTypeToggle = useCallback((type: string) => {
    setFilters((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((t) => t !== type)
        : [...prev.types, type],
    }));
  }, []);

  const handleGenChange = useCallback((gen: number | null) => {
    setFilters((prev) => ({ ...prev, gen }));
  }, []);

  const handleMarkSeen = useCallback(
    async (cardId: number) => {
      if (!session) return;

      const partialUpdated = markSeenInPasture(cardId, session);
      const updated: SavedSession = { ...session, cards: partialUpdated.cards };
      // saveSession dispatches the synthetic StorageEvent for same-tab
      // subscribers (useLocalStorageKey).
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
    // Render nothing until the client reads localStorage - avoids a flash of
    // the empty state on first paint for users who have mastered cards.
    return null;
  }

  // Superuser pretendAllMastered: source every species from the seed
  // directly so the pasture is fully populated even on a fresh or sparse
  // localStorage session. seenInPasture is forced true so the synthesized
  // cards don't sparkle as "new arrivals" in QA mode. Persisted state is left
  // untouched - markSeenInPasture is a no-op for ids not in session.cards.
  const masteredCards: NameReviewCard[] = flags.pretendAllMastered
    ? (seed?.seedPokemon ?? []).map((p) => ({
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
          pokemonNameLocale,
        ) as NameReviewCard[])
      : [];

  // Compute next arrivals from the full raw session (all card types, all
  // species - not just the mastered subset). Computed before the early-return
  // so the strip can show upcoming arrivals even when the Pasture is empty.
  // When pretendAllMastered is on, nextArrivals returns [] and the strip shows
  // an all-caught-up message.
  const arrivals = nextArrivals(
    session?.cards ?? [],
    flags.pretendAllMastered,
    masteryRepetitions,
    pokemonNameLocale,
  );

  if (masteredCards.length === 0) {
    return (
      <PageShell width="wide">
        <h1 className={pageTitle}>
          {t("title")}
        </h1>
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          {t("emptyBody")}
        </p>
        <div className="mt-4">
          <OnboardingHint id="pastureLongPressHintDismissed" tone="hint">
            <p>{t("longPressHint")}</p>
          </OnboardingHint>
        </div>
        <NextArrivalsStrip arrivals={arrivals} />
      </PageShell>
    );
  }

  const visibleCards = applyFilters(masteredCards, filters);

  const zones = buildZoneData(
    visibleCards,
    masteredCards,
    flags.pretendAllMastered,
  );

  const filtered = isFiltered(filters);

  return (
    <PageShell width="wide">
      <h1 className={`mb-6 ${pageTitle}`}>
        {t("title")}
        <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
          {t("pokemonCount", { count: masteredCards.length })}
        </span>
      </h1>

      <PastureSearchBar
        filters={filters}
        onQueryChange={handleQueryChange}
        onTypeToggle={handleTypeToggle}
        onGenChange={handleGenChange}
      />

      <div className="mt-4">
        <OnboardingHint id="pastureLongPressHintDismissed" tone="hint">
          <p>{t("longPressHint")}</p>
        </OnboardingHint>
      </div>

      {zones.length === 0 && filtered ? (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          {t("noFilterMatch")}
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

      <NextArrivalsStrip arrivals={arrivals} />
    </PageShell>
  );
}
