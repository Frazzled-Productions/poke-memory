import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
const { FIXTURE_CARD, FIXTURE_CARDS_4, mockSeedPokemon, mockLoadSettings } = vi.hoisted(() => {
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
    // buildSession calls initialReviewState(now) for each card, so these
    // values are overwritten and have no effect on test behaviour.
    state: {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "1970-01-01", // arbitrary — ignored by buildSession
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
    },
  };

  function makeExtra(id: number, name: string): typeof card {
    return { ...card, id, name, spriteUrl: `https://example.com/${name.toLowerCase()}.png` };
  }

  const defaultSettings = {
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
  };

  return {
    FIXTURE_CARD: card,
    FIXTURE_CARDS_4: [card, makeExtra(2, "Ivysaur"), makeExtra(3, "Venusaur"), makeExtra(4, "Charmander")],
    mockSeedPokemon: vi.fn(() => [card]),
    mockLoadSettings: vi.fn(() => defaultSettings),
  };
});

vi.mock("@/lib/pokemon/seed", () => ({
  get SEED_POKEMON() {
    return mockSeedPokemon();
  },
  SEED_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
}));

// loadSession returns null so buildSession always rebuilds state from scratch —
// the state fields on FIXTURE_CARD are never read during these tests.
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => null,
  saveSession: vi.fn(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
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
  mockSeedPokemon.mockReturnValue([FIXTURE_CARD]);
  mockLoadSettings.mockReturnValue({
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
  });
});


describe("ReviewSession reveal flow", () => {
  it("shows Reveal button and hides the Pokémon name before reveal", async () => {
    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
      expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
    });
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

    // Grade "Easy" (grade 5) so the card graduates immediately (Case A2:
    // brand-new + Easy → no learning step). "Good" (grade 4) would send the
    // card into learningStep 0 and show CountdownScreen instead.
    const easyBtn = screen.getByRole("button", { name: /easy/i });
    await user.click(easyBtn);

    // After graduating the only card the session-complete screen should appear.
    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /easy/i })).not.toBeInTheDocument();
  });
});

describe("ReviewSession reverse card flow", () => {
  const reverseSettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    reverseCardsEnabled: true,
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
    nameCardsEnabled: false,
    evolutionCardsEnabled: false,
  };

  beforeEach(() => {
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(reverseSettings);
  });

  /** Extract the current card's target name from the SpritePicker group aria-label. */
  function getTargetName(): string {
    const group = screen.getByRole("group");
    const label = group.getAttribute("aria-label") ?? "";
    const match = label.match(/Which Pokémon is (.+)\?/);
    return match?.[1] ?? "";
  }

  it("shows the Pokémon name as a prompt and sprite tiles but no Reveal button", async () => {
    render(<ReviewSession />);

    // 4 sprite tile buttons are rendered — no Reveal button.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button")).toHaveLength(4);
    });

    // The name prompt is shown (from SpritePicker's group aria-label).
    const targetName = getTargetName();
    expect(["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"]).toContain(targetName);
  });

  it("correct tile tap grades Good and advances to the next card", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(4));

    const targetName = getTargetName();
    const correctTile = screen.getByRole("button", { name: targetName });
    await user.click(correctTile);

    // After CORRECT_FEEDBACK_MS (600ms) the next card loads: tiles re-enabled.
    // Use 3 000ms waitFor timeout to allow the real timer to fire.
    await waitFor(
      () => {
        const tiles = screen.getAllByRole("button");
        expect(tiles).toHaveLength(4);
        tiles.forEach((tile) => expect(tile).not.toBeDisabled());
      },
      { timeout: 3000 },
    );
  });

  it("incorrect tile tap shows feedback then grades Again and advances", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(4));

    const targetName = getTargetName();
    const tiles = screen.getAllByRole("button");

    // Click a tile that is NOT the correct answer.
    const incorrectTile = tiles.find(
      (tile) => tile.getAttribute("aria-label") !== targetName,
    )!;
    await user.click(incorrectTile);

    // Tiles are disabled immediately and the correct-answer label appears.
    await waitFor(() => {
      screen.getAllByRole("button").forEach((tile) => expect(tile).toBeDisabled());
      expect(
        screen.getByText(new RegExp(`correct answer was ${targetName}`, "i")),
      ).toBeInTheDocument();
    });

    // After INCORRECT_FEEDBACK_MS (1 200ms) the next card loads: tiles re-enabled.
    await waitFor(
      () => {
        const nextTiles = screen.getAllByRole("button");
        expect(nextTiles).toHaveLength(4);
        nextTiles.forEach((tile) => expect(tile).not.toBeDisabled());
      },
      { timeout: 3000 },
    );
  });
});
