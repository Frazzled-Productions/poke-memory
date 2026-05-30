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
  hydrateSession: vi.fn((_saved: unknown[], _seed: unknown[]) => []),
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
});
