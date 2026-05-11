import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReviewSession } from "@/components/review/ReviewSession";
import type { NameReviewCard } from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";

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
  return { FIXTURE_CARD: card };
});

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [FIXTURE_CARD],
  SEED_EVOLUTION_CARDS: [],
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockReturnValue(null),
  saveSession: vi.fn(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => ({
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

describe("Regression: migration-shape learning card (stepStartedAt: null)", () => {
  // Card persisted in the migration-gap shape: learningStep is set but
  // stepStartedAt was backfilled to null (old schema). This is the shape
  // that caused a reload after grading to re-show the already-graded card.
  const MIGRATION_CARD: NameReviewCard = {
    ...FIXTURE_CARD,
    state: {
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: "2026-05-11",
      lastReview: null,
      firstSeen: "2026-05-11",
      learningStep: 0,     // in learning step
      stepStartedAt: null, // migration gap — no start time recorded
    },
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows countdown screen instead of Reveal UI after reload when stepStartedAt is null", async () => {
    // Pin Date.now() only (not setTimeout/setInterval) so waitFor still works.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [MIGRATION_CARD],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // With the fix, the card's dueAt is Date.now() + stepMs (60 s in the
    // future), so it is not yet due. The component must show the countdown
    // screen, not the card's Reveal UI.
    await waitFor(() =>
      expect(screen.getByText(/next card in/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });

  it("persists stamped stepStartedAt so subsequent reloads use the same countdown anchor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [MIGRATION_CARD],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // saveSession must be called with a concrete (numeric) stepStartedAt so
    // that a subsequent reload reads the fixed anchor instead of stamping a
    // fresh Date.now() and drifting the countdown window.
    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              state: expect.objectContaining({
                stepStartedAt: expect.any(Number),
              }),
            }),
          ]),
        }),
      );
    });
  });
});
