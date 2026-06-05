/**
 * Smoke tests for the per-biome landscape page (#923).
 *
 * Covers line 80 in app/pasture/[biome]/page.tsx - the useLocalStorageKey
 * call that was previously uninstrumented and failing the diff-coverage gate.
 */

import { act } from "@testing-library/react";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
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

// Stub heavy child component.
vi.mock("@/components/pasture/PastureZone", () => ({
  PastureZone: () => <div data-testid="pasture-zone" />,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import BiomeLandscapePage from "@/app/pasture/[biome]/page";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

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
});
