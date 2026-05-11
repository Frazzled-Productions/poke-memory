import { act, render, screen, waitFor } from "@testing-library/react";
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
    state: {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "1970-01-01",
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
    },
  };

  function makeExtra(id: number, name: string): typeof card {
    return { ...card, id, name, spriteUrl: `https://example.com/${name.toLowerCase()}.png` };
  }

  const cards4 = [
    card,
    makeExtra(2, "Ivysaur"),
    makeExtra(3, "Venusaur"),
    makeExtra(4, "Charmander"),
  ];

  return {
    FIXTURE_CARD: card,
    FIXTURE_CARDS_4: cards4,
    mockSeedPokemon: vi.fn(() => [card]),
    mockLoadSettings: vi.fn(() => ({
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
    })),
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

// loadSession returns null so buildSession always rebuilds state from scratch.
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
  // Restore defaults before each test so suites don't bleed into each other.
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
    vi.useFakeTimers();
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(reverseSettings);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the Pokémon name as a prompt and sprite tiles but no Reveal button", async () => {
    render(<ReviewSession />);

    await waitFor(() => {
      // No Reveal button — reverse cards use the SpritePicker flow
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
      // 4 sprite tile buttons (one per candidate)
      const tileButtons = screen.getAllByRole("button");
      expect(tileButtons.length).toBe(4);
    });
  });

  it("correct tile tap grades Good and advances", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<ReviewSession />);

    // Wait for the session to hydrate — a name prompt and 4 tiles appear.
    const tileButtons = await screen.findAllByRole("button");
    expect(tileButtons).toHaveLength(4);

    // The SpritePicker renders the target name as a text node. Find which
    // tile's aria-label matches that name — that tile is the correct answer.
    const nameLabels = tileButtons.map((btn) => btn.getAttribute("aria-label"));
    // The heading is a <p> with the target name; find the displayed name text.
    const allText = tileButtons.map((btn) => btn.getAttribute("aria-label")).filter(Boolean);
    // All 4 pokemon names are in the pool; pick the one that matches the current card heading.
    const pokemonNames = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"];
    const displayedName = pokemonNames.find((n) =>
      screen.queryByText(n),
    );
    expect(displayedName).toBeTruthy();

    const correctTile = screen.getByRole("button", { name: displayedName! });
    await user.click(correctTile);

    // Advance past CORRECT_FEEDBACK_MS so onGrade(true) fires → handleGrade(4)
    act(() => {
      vi.advanceTimersByTime(700);
    });

    // After grading the first card Good, it enters a learning step and the
    // next new card is served. No Reveal button — still SpritePicker.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
      // Still showing 4 tile buttons for the next card
      expect(screen.getAllByRole("button")).toHaveLength(4);
      // The name prompt has changed (or CountdownScreen if all cards graded)
    });

    // Tiles must be re-enabled (new card, no answer yet)
    const newTiles = screen.getAllByRole("button");
    newTiles.forEach((tile) => {
      expect(tile).not.toBeDisabled();
    });
  });

  it("incorrect tile tap shows brief feedback then grades Again and advances", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<ReviewSession />);

    const tileButtons = await screen.findAllByRole("button");
    expect(tileButtons).toHaveLength(4);

    const pokemonNames = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"];
    const displayedName = pokemonNames.find((n) => screen.queryByText(n));
    expect(displayedName).toBeTruthy();

    // Click a tile that is NOT the correct answer
    const incorrectTile = tileButtons.find(
      (btn) => btn.getAttribute("aria-label") !== displayedName,
    );
    expect(incorrectTile).toBeDefined();
    await user.click(incorrectTile!);

    // Tiles must be disabled during feedback
    const disabledTiles = screen.getAllByRole("button");
    disabledTiles.forEach((tile) => {
      expect(tile).toBeDisabled();
    });

    // Feedback text mentioning the correct answer is shown
    expect(
      screen.getByText(new RegExp(`correct answer was ${displayedName}`, "i")),
    ).toBeInTheDocument();

    // Advance past INCORRECT_FEEDBACK_MS so onGrade(false) fires → handleGrade(1)
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    // After the feedback delay the next card is served; tiles re-enabled
    await waitFor(() => {
      const nextTiles = screen.getAllByRole("button");
      expect(nextTiles).toHaveLength(4);
      nextTiles.forEach((tile) => {
        expect(tile).not.toBeDisabled();
      });
    });
  });
});
