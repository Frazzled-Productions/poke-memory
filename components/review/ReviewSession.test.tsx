import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReviewSession } from "@/components/review/ReviewSession";
import type { NameReviewCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// vi.mock factories are hoisted — define seed data via vi.hoisted so the
// factory closure can reference it before the module-level const is initialised.
const { FIXTURE_CARD } = vi.hoisted(() => {
  const card: NameReviewCard = {
    id: 1,
    name: "Bulbasaur",
    spriteUrl: "https://example.com/bulbasaur.png",
    types: ["grass", "poison"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A strange seed was planted on its back at birth.",
    flavorTexts: ["A strange seed was planted on its back at birth."],
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
    cardType: "name",
    state: {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "2026-05-09",
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
    },
  };
  return { FIXTURE_CARD: card };
});

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [FIXTURE_CARD],
  SEED_EVOLUTION_CARDS: [],
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => null,
  saveSession: vi.fn(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => ({
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
  }),
}));

vi.mock("@/lib/streak", () => ({
  recordReview: vi.fn(),
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, supabase: null, loading: false }),
}));

vi.mock("@/lib/sync/useSyncOnUnload", () => ({
  useSyncOnUnload: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});


describe("ReviewSession reveal flow", () => {
  it("shows Reveal button and hides the Pokémon name before reveal", async () => {
    render(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument(),
    );

    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("shows name and grade buttons after clicking Reveal", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("advances to next card and resets reveal state after grading", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    const goodBtn = screen.getByRole("button", { name: /good/i });
    await user.click(goodBtn);

    // After grading the only card the session-complete screen should appear.
    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /good/i })).not.toBeInTheDocument();
  });
});
