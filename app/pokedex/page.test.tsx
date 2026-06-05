/**
 * Smoke tests for the Pokédex page (#923).
 *
 * Covers line 19 in app/pokedex/page.tsx - the useLocalStorageKey call that
 * was previously uninstrumented and was failing the diff-coverage gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks - all declared before the component import.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pokedex",
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/stats/derive", () => ({
  classifyCard: vi.fn(() => "locked" as const),
  isMastered: vi.fn(() => false),
  MASTERY_REPETITIONS: 3,
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [
    {
      id: 1,
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Bulbasaur",
      name: "Bulbasaur",
      spriteUrl: "/sprites/pokemon/1.png",
      types: ["grass", "poison"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "A grass Pokémon.",
      flavorTexts: ["A grass Pokémon."],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed Pokémon",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: "grassland",
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
    },
  ],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

// Stub heavy child components so the render is fast and focused.
vi.mock("@/components/pokedex/PokedexGrid", () => ({
  default: () => <div data-testid="pokedex-grid" />,
  LoadingSkeleton: () => <div data-testid="loading-skeleton" />,
}));

vi.mock("@/components/pokedex/PokedexFiltered", () => ({
  default: () => <div data-testid="pokedex-filtered" />,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import PokedexPage from "@/app/pokedex/page";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSession.mockResolvedValue(null);
});

describe("PokedexPage", () => {
  it("renders the Pokédex heading and calls useLocalStorageKey", async () => {
    renderWithIntl(<PokedexPage />);

    expect(useLocalStorageKey).toHaveBeenCalledWith("poke-memory:review-session:v1");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /pokédex/i })).toBeInTheDocument();
    });
  });

  it("shows the filtered grid once session data has loaded", async () => {
    mockLoadSession.mockResolvedValue(null);

    renderWithIntl(<PokedexPage />);

    await waitFor(() => {
      expect(screen.getByTestId("pokedex-filtered")).toBeInTheDocument();
    });
  });
});
