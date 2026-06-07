/**
 * Smoke tests for the per-biome landscape page (#923).
 *
 * Covers line 80 in app/pasture/[biome]/page.tsx - the useLocalStorageKey
 * call that was previously uninstrumented and failing the diff-coverage gate.
 */

import { act } from "@testing-library/react";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks - declared before the component import.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/pasture/grassland",
  notFound: vi.fn(() => null),
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

const { mockLoadSession, STABLE_SEED } = vi.hoisted(() => ({
  mockLoadSession: vi.fn(),
  // Stable object reference so the seed dep in useEffect doesn't trigger
  // a re-render loop when the mock is called on every render.
  STABLE_SEED: { seedPokemon: [] as unknown[], seedEvolutionCards: [] as unknown[], seedReverseEvolutionCards: [] as unknown[] },
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

vi.mock("@/lib/review/session", () => ({
  hydrateSession: vi.fn((_saved: unknown[]) => ({ cards: [], anyHealed: false })),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false }, anyFlagOn: false }),
}));

vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: vi.fn(() => []),
  markSeenInPasture: vi.fn((id: number, session: unknown) => session),
  justBecameMastered: vi.fn(() => false),
  isMastered: vi.fn(() => false),
}));

vi.mock("@/lib/pasture/zones", () => ({
  HABITAT_ZONES: [
    {
      habitat: "grassland",
      label: "Grassland",
      subRegions: [],
      anchors: [],
    },
  ],
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

// Locale-name resolution for the per-biome "Latest addition" (#1662).
let mockPokemonLocale = "en";
const mockLocaleNames: Record<string, string> = {};

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_speciesId: number | undefined, englishName: string) => ({
    name: mockLocaleNames[mockPokemonLocale] ?? englishName,
    transliteration: null,
  }),
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({
    locale: mockPokemonLocale,
    languagesEnabled: false,
    learningLocales: ["en"],
  }),
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

vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => ({
    seed: STABLE_SEED,
    error: null,
    retry: vi.fn(),
  }),
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

// Stub heavy child component.
vi.mock("@/components/pasture/PastureZone", () => ({
  PastureZone: () => <div data-testid="pasture-zone" />,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import BiomeLandscapePage from "@/app/pasture/[biome]/page";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { biomeStats } from "@/lib/pasture/stats";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSession.mockResolvedValue(null);

  // jsdom does not implement window.matchMedia - provide a minimal stub so the
  // useIsLandscape hook inside BiomeLandscapePage does not throw.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("BiomeLandscapePage", () => {
  it("calls useLocalStorageKey with the session storage key (line 80)", async () => {
    // Pass params as a resolved Promise as Next.js 16 requires.
    // The component uses React.use() to unwrap params, which suspends until
    // the Promise resolves - we must flush the microtask queue with act().
    const params = Promise.resolve({ biome: "grassland" });

    await act(async () => {
      renderWithIntl(<BiomeLandscapePage params={params} />);
      // Flush the params Promise resolution so the component body runs past
      // the use(params) call and reaches useLocalStorageKey.
      await params;
    });

    expect(useLocalStorageKey).toHaveBeenCalledWith("poke-memory:review-session:v1");
  });

  it("renders nothing while loading from localStorage (masteredCards is null)", () => {
    // loadSession never resolves in this render - the page returns null while
    // loading, so the rendered output should be empty.
    mockLoadSession.mockReturnValue(new Promise(() => {}));
    const params = Promise.resolve({ biome: "grassland" });

    const { container } = renderWithIntl(<BiomeLandscapePage params={params} />);

    // While loading the component renders null - the container has no children.
    expect(container.firstChild).toBeNull();
  });

  it("renders the locale-resolved Latest addition name with a lang attribute (#1662)", async () => {
    mockPokemonLocale = "ja";
    mockLocaleNames["ja"] = "ピカチュウ";
    vi.mocked(biomeStats).mockReturnValueOnce({
      masteredCount: 1,
      totalCount: 10,
      capturedPercent: 10,
      latestAddition: { speciesId: 25, name: "Pikachu" },
    });
    mockLoadSession.mockResolvedValue(null);
    const params = Promise.resolve({ biome: "grassland" });

    await act(async () => {
      renderWithIntl(<BiomeLandscapePage params={params} />);
      await params;
    });
    // Flush the async load() effect so masteredCards is set and the stats
    // strip (with BiomeLatestAddition) renders.
    await act(async () => {
      await Promise.resolve();
    });

    const nameEl = screen.getByText("ピカチュウ");
    expect(nameEl.tagName).toBe("SPAN");
    expect(nameEl).toHaveAttribute("lang", "ja");
  });

  // ---------------------------------------------------------------------------
  // Heading hierarchy (#1758)
  // ---------------------------------------------------------------------------

  describe("heading hierarchy", () => {
    async function renderLoaded(biome = "grassland") {
      const params = Promise.resolve({ biome });
      await act(async () => {
        renderWithIntl(<BiomeLandscapePage params={params} />);
        await params;
      });
      // Flush async load() effect so masteredCards is set and the header renders.
      await act(async () => {
        await Promise.resolve();
      });
    }

    it("renders exactly one h1 containing the biome label", async () => {
      await renderLoaded("grassland");

      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      // The zone label from the HABITAT_ZONES mock is "Grassland".
      expect(headings[0]).toHaveTextContent("Grassland");
    });

    it("h1 text includes the Pokémon count in parentheses", async () => {
      await renderLoaded("grassland");

      // biomeCards is empty in this test (filterMastered returns []) so count is 0.
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(h1).toHaveTextContent("Grassland");
      expect(h1).toHaveTextContent("(0)");
    });

    it("does not render any h2 or h3 directly in the page output", async () => {
      // PastureZone is mocked to a plain <div> - it does not contribute
      // headings in the test environment. Verifying the page itself does
      // not accidentally skip levels by emitting h2/h3 without a prior h1.
      await renderLoaded("grassland");

      // h2 / h3 from the page's own markup (PastureZone is mocked away).
      const h2s = screen.queryAllByRole("heading", { level: 2 });
      const h3s = screen.queryAllByRole("heading", { level: 3 });
      expect(h2s).toHaveLength(0);
      expect(h3s).toHaveLength(0);
    });

    it("h1 is present in the empty-state branch (no mastered Pokémon)", async () => {
      // loadSession returns null → filterMastered returns [] → isEmpty = true.
      mockLoadSession.mockResolvedValue(null);
      const params = Promise.resolve({ biome: "grassland" });
      await act(async () => {
        renderWithIntl(<BiomeLandscapePage params={params} />);
        await params;
      });
      await act(async () => {
        await Promise.resolve();
      });

      // Even with an empty biome the h1 must be present.
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Grassland");
    });
  });
});
