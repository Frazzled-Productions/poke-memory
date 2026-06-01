/**
 * Smoke tests for the Pasture page (#923).
 *
 * Covers lines 95 and 157 in app/pasture/page.tsx — both are the
 * useLocalStorageKey call and the handleMarkSeen callback body, which were
 * previously uninstrumented and failing the diff-coverage gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks — declared before the component import.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/pasture",
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Hoisted fixtures.
// ---------------------------------------------------------------------------

const { mockLoadSession } = vi.hoisted(() => ({
  mockLoadSession: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: mockLoadSession,
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
  bumpSessionStorageKey: vi.fn(),
  STORAGE_KEY: "poke-memory:review-session:v1",
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => 0),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    reverseCardsEnabled: false,
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
    nameCardsEnabled: true,
    evolutionCardsEnabled: true,
    cryCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
    retentionTarget: 0.9,
    pokemonNameLocale: "en" as const,
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, supabase: null, loading: false }),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false }, anyFlagOn: false }),
}));

vi.mock("@/lib/review/session", () => ({
  hydrateSession: vi.fn((_saved: unknown[], _seed: unknown[]) => ({ cards: [], anyHealed: false })),
}));

vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: vi.fn(() => []),
  markSeenInPasture: vi.fn((id: number, session: unknown) => session),
  justBecameMastered: vi.fn(() => false),
  isMastered: vi.fn(() => false),
}));

vi.mock("@/lib/pasture/zones", () => ({
  HABITAT_ZONES: [],
}));

vi.mock("@/lib/pasture/assign", () => ({
  assignAnchors: vi.fn(() => []),
}));

vi.mock("@/lib/pasture/stats", () => ({
  biomeStats: vi.fn(() => ({
    masteredCount: 0,
    totalCount: 0,
    capturedPercent: 0,
    latestAddition: null,
  })),
}));

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn().mockResolvedValue(undefined),
  pullSession: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

vi.mock("@/lib/srs/scheduler", () => ({
  initialReviewState: vi.fn(() => ({
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new" as const,
    dueDate: "2099-01-01",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  })),
}));

// Stub heavy child components.
vi.mock("@/components/pasture/PastureZone", () => ({
  PastureZone: () => <div data-testid="pasture-zone" />,
}));

vi.mock("@/components/pasture/PastureSearchBar", () => ({
  PastureSearchBar: ({
    onQueryChange,
  }: {
    onQueryChange: (q: string) => void;
  }) => (
    <input
      aria-label="search pasture"
      onChange={(e) => onQueryChange(e.target.value)}
    />
  ),
  PASTURE_FILTERS_DEFAULT: { query: "", types: [], gen: null },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import PasturePage from "@/app/pasture/page";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { hydrateSession } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";
import { filterMastered } from "@/lib/pasture/arrivals";
import { saveSession } from "@/lib/review/persistence";

// ---------------------------------------------------------------------------
// Fixtures for the hydrate→filter→count regression test
// ---------------------------------------------------------------------------

/**
 * A minimal saved card as it exists in localStorage BEFORE hydration:
 * no habitat, no isDefaultForm — exactly the gap that caused the #1394
 * regression where all species fell into the "unknown"/Wildlands bucket and
 * biomeStats reported 0 mastered per biome.
 */
const MASTERED_FSRS_STATE = {
  stability: 30,
  difficulty: 5,
  elapsedDays: 30,
  scheduledDays: 30,      // >= 21 → meets mastery interval requirement
  reps: 3,                // >= masteryRepetitions (3) → meets reps requirement
  lapses: 0,
  fsrsState: "review" as const,
  dueDate: "2099-01-01",
  lastReview: "2026-04-30",
  firstSeen: "2026-03-01",
  learningStep: null,
  stepStartedAt: null,
  hiddenSince: null,
  seenInPasture: false,
};

/**
 * The card BEFORE hydration — minimal shape matching what QA-seed and
 * localStorage store: no habitat, no isDefaultForm.
 */
const RAW_SAVED_NAME_CARD = {
  id: 25,
  cardType: "name" as const,
  subjectKey: "25",
  locale: "en" as const,
  state: MASTERED_FSRS_STATE,
  // Fields that ARE present on saved cards:
  displayName: "Pikachu",
  name: "pikachu",
  speciesId: 25,
  spriteUrl: "/sprites/pokemon/25.png",
  types: ["electric"],
  // The two fields that QA-seeded cards do NOT have — this is the gap:
  // habitat and isDefaultForm are undefined here.
};

/**
 * The reverse card for the same species — also mastered. filterMastered
 * requires BOTH the name card and the reverse card to be mastered for a
 * species to appear in the pasture (since #1234).
 */
const RAW_SAVED_REVERSE_CARD = {
  id: 2_000_025, // REVERSE_ID_OFFSET (2_000_000) + speciesId (25)
  cardType: "reverse" as const,
  subjectKey: "25",
  locale: "en" as const,
  state: MASTERED_FSRS_STATE,
  displayName: "Pikachu",
  name: "pikachu",
  speciesId: 25,
  spriteUrl: "/sprites/pokemon/25.png",
  types: ["electric"],
};

/**
 * The card AFTER hydration — hydrateSession backfills habitat and
 * isDefaultForm from SEED_POKEMON so biomeStats and buildZoneData can
 * place the card in the correct biome bucket.
 */
const HYDRATED_NAME_CARD = {
  ...RAW_SAVED_NAME_CARD,
  habitat: "forest",
  isDefaultForm: true,
  formCategory: "default" as const,
  formSlug: null,
  stats: { hp: 35, attack: 55, defense: 40, specialAttack: 50, specialDefense: 50, speed: 90 },
  flavorText: "Electric mouse.",
  flavorTexts: undefined,
  evolutionChain: [],
  height: 4,
  weight: 60,
  baseExperience: 112,
  genus: "Mouse Pokémon",
  generation: "generation-i",
  captureRate: 190,
  baseHappiness: 70,
  growthRate: "medium",
  genderRate: 4,
  isLegendary: false,
  isMythical: false,
  cryUrl: null,
  versionGroups: [],
  localNames: {},
};

const HYDRATED_REVERSE_CARD = {
  ...RAW_SAVED_REVERSE_CARD,
  habitat: "forest",
  isDefaultForm: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSession.mockResolvedValue(null);
});

describe("PasturePage", () => {
  it("calls useLocalStorageKey with the session storage key (line 95)", () => {
    renderWithIntl(<PasturePage />);

    expect(useLocalStorageKey).toHaveBeenCalledWith("poke-memory:review-session:v1");
  });

  it("renders the empty-pasture message when there are no mastered cards (line 157 path)", async () => {
    // With no session and no mastered cards the page shows the empty-state copy
    // after loading — this exercises the loaded branch at line 157 onwards.
    mockLoadSession.mockResolvedValue(null);

    renderWithIntl(<PasturePage />);

    await waitFor(() => {
      expect(
        screen.getByText(/master your first pokémon/i),
      ).toBeInTheDocument();
    });
  });

  /**
   * Regression guard for #1394 — the hydrate→filter→count chain.
   *
   * Before the fix, the Pasture page called filterMastered on the raw saved
   * session (no habitat, no isDefaultForm). biomeStats then fell back to the
   * "unknown" bucket for every species and reported 0 mastered per biome.
   *
   * The fix adds a hydrateSession call that backfills those fields from
   * SEED_POKEMON before filtering. This test guards that path:
   *
   * 1. loadSession returns raw cards (no habitat/isDefaultForm).
   * 2. hydrateSession is called and returns enriched cards with those fields.
   * 3. filterMastered is given the HYDRATED cards and returns the mastered set.
   * 4. The mastered count in the page heading is non-zero.
   *
   * If someone removes the hydrateSession call, step 2 assertion fails and
   * filterMastered receives the raw cards instead — the mock returns [] for
   * non-hydrated input, making the heading disappear and step 4 fail too.
   */
  it("hydrates saved cards before filtering — mastered count is non-zero (#1394 regression)", async () => {
    const rawCards = [RAW_SAVED_NAME_CARD, RAW_SAVED_REVERSE_CARD];
    const hydratedCards = [HYDRATED_NAME_CARD, HYDRATED_REVERSE_CARD];

    // Return a real session whose cards are in the un-hydrated shape
    // (no habitat, no isDefaultForm) — exactly the QA-seed / localStorage shape.
    mockLoadSession.mockResolvedValue({
      cards: rawCards,
      buildTimestamp: "2026-01-01T00:00:00.000Z",
    });

    // hydrateSession is called by the page with the raw cards; it returns the
    // enriched set. The mock simulates the real hydration step.
    vi.mocked(hydrateSession).mockReturnValueOnce({ cards: hydratedCards as unknown as ReviewableCard[], anyHealed: false });

    // filterMastered is called twice per render (once for masteredCount, once
    // for masteredCards). Use mockImplementation (not Once) so both calls
    // return the mastered subset. The implementation is conditional: it returns
    // the mastered card only when the input has been hydrated (habitat === "forest"),
    // so the test fails if hydrateSession is bypassed and the raw cards — which
    // have no habitat — are passed to filterMastered instead.
    vi.mocked(filterMastered).mockImplementation((cards) => {
      // Only return mastered cards when the input has been hydrated (has habitat).
      const firstCard = cards[0] as { habitat?: string; cardType: string };
      if (firstCard?.habitat === "forest") {
        return [HYDRATED_NAME_CARD] as ReturnType<typeof filterMastered>;
      }
      return [];
    });

    renderWithIntl(<PasturePage />);

    // Assert hydrateSession was called — removing it breaks this step.
    await waitFor(() => {
      expect(hydrateSession).toHaveBeenCalled();
    });

    // Assert the mastered count heading appears with the correct count.
    // This disappears when filterMastered returns [] (i.e. when the hydrated
    // cards are not passed through), so it guards the full hydrate→filter→count chain.
    await waitFor(() => {
      expect(screen.getByText(/1 pokémon/i)).toBeInTheDocument();
    });
  });

  /**
   * Inverse of the regression guard: if hydrateSession returns the raw
   * (un-enriched) cards — as though the call were absent — the filterMastered
   * mock returns [] and the empty-state body is shown instead of the count.
   *
   * This makes the regression explicit: a reviewer can see exactly what breaks
   * when the hydration step is removed.
   */
  it("shows empty state when hydrateSession returns un-hydrated cards (#1394 regression, inverse)", async () => {
    const rawCards = [RAW_SAVED_NAME_CARD, RAW_SAVED_REVERSE_CARD];

    mockLoadSession.mockResolvedValue({
      cards: rawCards,
      buildTimestamp: "2026-01-01T00:00:00.000Z",
    });

    // hydrateSession returns the raw cards unchanged — simulating its removal.
    vi.mocked(hydrateSession).mockReturnValueOnce({ cards: rawCards as unknown as ReviewableCard[], anyHealed: false });

    // filterMastered returns [] for un-hydrated cards (no habitat).
    vi.mocked(filterMastered).mockImplementation((cards) => {
      const firstCard = cards[0] as { habitat?: string };
      if (firstCard?.habitat === "forest") {
        return [HYDRATED_NAME_CARD] as ReturnType<typeof filterMastered>;
      }
      return [];
    });

    renderWithIntl(<PasturePage />);

    // Empty state is shown — the count heading is absent.
    await waitFor(() => {
      expect(screen.getByText(/master your first pokémon/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/1 pokémon/i)).not.toBeInTheDocument();
  });

  /**
   * Persistence fixed-point guard for #1506 — non-Practice entry paths.
   *
   * When hydrateSession reports anyHealed:true, the Pasture page must call
   * saveSession with the healed cards so the fixed point is reached on the
   * NEXT load (second hydrateSession → anyHealed:false) regardless of whether
   * the user ever opens Practice first.
   */
  it("calls saveSession when hydrateSession reports anyHealed:true (#1506)", async () => {
    const rawCards = [RAW_SAVED_NAME_CARD];
    const healedCards = [{ ...RAW_SAVED_NAME_CARD, state: { ...RAW_SAVED_NAME_CARD.state, fsrsState: "new" as const, lastReview: null, reps: 0, lapses: 0, stability: 0, difficulty: 0 } }];

    mockLoadSession.mockResolvedValue({
      cards: rawCards,
      limits: { name: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 }, reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 }, cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 } },
    });

    // Simulate hydrateSession reporting a heal.
    vi.mocked(hydrateSession).mockReturnValueOnce({ cards: healedCards as unknown as ReviewableCard[], anyHealed: true });

    renderWithIntl(<PasturePage />);

    // saveSession must be called with the healed cards so the corrected state
    // persists — subsequent loads will find anyHealed:false and skip the write.
    await waitFor(() => {
      expect(saveSession).toHaveBeenCalledWith(
        expect.objectContaining({ cards: healedCards }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Pasture empty state copy (#1440)
//
// Verifies that the updated emptyBody copy explains the Pasture's purpose
// (mastered-collection view) in all four locales.
// ---------------------------------------------------------------------------

describe("PasturePage — empty state copy (#1440)", () => {
  it("en: empty state explains the mastered-collection purpose", async () => {
    mockLoadSession.mockResolvedValue(null);
    renderWithIntl(<PasturePage />);

    await waitFor(() => {
      expect(
        screen.getByText(/the pasture is your mastered-pokémon collection/i),
      ).toBeInTheDocument();
    });
  });

  it("ja: empty state copy renders in Japanese", async () => {
    mockLoadSession.mockResolvedValue(null);
    renderWithIntl(<PasturePage />, { locale: "ja" });

    await waitFor(() => {
      // New ja emptyBody contains "牧場はあなたが習得した"
      expect(
        screen.getByText(/牧場はあなたが習得した/),
      ).toBeInTheDocument();
    });
  });

  it("zh-Hans: empty state copy renders in Simplified Chinese", async () => {
    mockLoadSession.mockResolvedValue(null);
    renderWithIntl(<PasturePage />, { locale: "zh-Hans" });

    await waitFor(() => {
      expect(
        screen.getByText(/牧场是你已掌握宝可梦的收藏/),
      ).toBeInTheDocument();
    });
  });

  it("zh-Hant: empty state copy renders in Traditional Chinese", async () => {
    mockLoadSession.mockResolvedValue(null);
    renderWithIntl(<PasturePage />, { locale: "zh-Hant" });

    await waitFor(() => {
      expect(
        screen.getByText(/牧場是你已掌握寶可夢的收藏/),
      ).toBeInTheDocument();
    });
  });
});
