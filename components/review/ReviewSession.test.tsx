import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReviewSession } from "@/components/review/ReviewSession";
import type { NameReviewCard } from "@/lib/review/session";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { LEARNING_STEPS_MS, RELEARNING_STEPS_MS } from "@/lib/srs/constants";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const { mockPlayCry } = vi.hoisted(() => ({ mockPlayCry: vi.fn() }));

vi.mock("@/lib/audio/cry", () => ({ playCry: mockPlayCry }));

// vi.mock factories are hoisted — define seed data via vi.hoisted so the
// factory closure can reference it before the module-level const is initialised.
const { FIXTURE_CARD, FIXTURE_CARDS_4, mockSeedPokemon, mockLoadSettings } = vi.hoisted(() => {
  const card: NameReviewCard = {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
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
    cryUrl: null,
    cardType: "name",
    subjectKey: "1",
    // buildSession calls initialReviewState(now) for each card, so these
    // values are overwritten and have no effect on test behaviour.
    state: {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new" as const,
      dueDate: "1970-01-01", // arbitrary — ignored by buildSession
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };

  function makeExtra(id: number, name: string): typeof card {
    return { ...card, id, name, subjectKey: String(id), spriteUrl: `https://example.com/${name.toLowerCase()}.png` };
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
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
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
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

// loadSession is a vi.fn() so individual tests can override it with
// mockReturnValueOnce; default returns null so buildSession rebuilds state.
vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockReturnValue(null),
  saveSession: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/streak", () => ({
  recordReview: vi.fn(),
  loadStreakData: vi.fn(() => []),
  computeStreak: vi.fn(() => 0),
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

/**
 * Buttons rendered inside the SpritePicker — excludes the new Undo and
 * Scope-toggle buttons that ReviewSession adds at the page level. Lets
 * the existing "exactly 4 tile buttons" assertions stay readable.
 */
function getTileButtons(): HTMLElement[] {
  return screen.getAllByRole("button").filter((b) => {
    if (/undo/i.test(b.getAttribute("aria-label") ?? "")) return false;
    if (/^hear /i.test(b.getAttribute("aria-label") ?? "")) return false;
    if (b.getAttribute("aria-controls") === "scope-panel") return false;
    if (/^Clear$/.test(b.textContent ?? "")) return false;
    return true;
  });
}

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
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
  });
  vi.mocked(loadSession).mockReturnValue(null);
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

  it("calls playCry with the card's cryUrl when playCryOnReveal is true", async () => {
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([{ ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" }]);
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
      playCryOnReveal: true,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // playCry is now always invoked with (url, volume, onEnded?) — onEnded is undefined
    // when speakNameOnReveal is off, which is the default for this fixture.
    expect(mockPlayCry).toHaveBeenCalledWith("https://example.com/bulbasaur.ogg", 0.6, undefined);
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
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
  };

  beforeEach(() => {
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(reverseSettings);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      expect(getTileButtons()).toHaveLength(4);
    });

    // The name prompt is shown (from SpritePicker's group aria-label).
    const targetName = getTargetName();
    expect(["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"]).toContain(targetName);
  });

  it("correct tile tap grades Good and advances to the next card", async () => {
    render(<ReviewSession />);
    // Wait for initial render with real timers (waitFor uses setTimeout internally).
    await waitFor(() => expect(getTileButtons()).toHaveLength(4));

    const targetName = getTargetName();
    const correctTile = screen.getByRole("button", { name: targetName });

    // Switch to fake timers only for the controlled advance.
    vi.useFakeTimers();
    act(() => { fireEvent.click(correctTile); });
    // Advance past CORRECT_FEEDBACK_MS (600ms) and flush state updates.
    await act(async () => { vi.advanceTimersByTime(700); });
    vi.useRealTimers();

    const tiles = getTileButtons();
    expect(tiles).toHaveLength(4);
    tiles.forEach((tile) => expect(tile).not.toBeDisabled());
  });

  it("incorrect tile tap shows feedback then grades Again and advances", async () => {
    render(<ReviewSession />);
    await waitFor(() => expect(getTileButtons()).toHaveLength(4));

    const targetName = getTargetName();
    const knownWrongNames = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"].filter(
      (n) => n !== targetName,
    );
    const tiles = getTileButtons();

    // Click a tile that is NOT the correct answer.
    const incorrectTile = tiles.find((tile) =>
      knownWrongNames.includes(tile.getAttribute("aria-label") ?? ""),
    )!;

    vi.useFakeTimers();
    act(() => { fireEvent.click(incorrectTile); });

    // Tiles are disabled immediately and the correct-answer label appears.
    getTileButtons().forEach((tile) => expect(tile).toBeDisabled());
    expect(
      screen.getByText(new RegExp(`correct answer was ${targetName}`, "i")),
    ).toBeInTheDocument();

    // Advance past INCORRECT_FEEDBACK_MS (1 200ms) and flush state updates.
    await act(async () => { vi.advanceTimersByTime(1300); });
    vi.useRealTimers();

    const nextTiles = getTileButtons();
    expect(nextTiles).toHaveLength(4);
    nextTiles.forEach((tile) => expect(tile).not.toBeDisabled());
  });
});

describe("Regression: migration-shape learning card (stepStartedAt: null)", () => {
  // Card persisted in the migration-gap shape: learningStep is set but
  // stepStartedAt was backfilled to null (old schema). This is the shape
  // that caused a reload after grading to re-show the already-graded card.
  const MIGRATION_CARD: NameReviewCard = {
    ...FIXTURE_CARD,
    state: {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new" as const,
      dueDate: "2026-05-11",
      lastReview: null,
      firstSeen: "2026-05-11",
      learningStep: 0,     // in learning step
      stepStartedAt: null, // migration gap — no start time recorded
      hiddenSince: null,
      seenInPasture: false,
    },
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the card via learn-ahead (not countdown) when stepStartedAt is null and dueAt is within 20 min", async () => {
    // Pin Date.now() only (not setTimeout/setInterval) so waitFor still works.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [MIGRATION_CARD],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // stepStartedAt is backfilled to Date.now(), so dueAt = now + 60 s.
    // Since 60 s < 20 min learn-ahead window and the queue is otherwise
    // empty, the card is pulled forward and presented for review.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/next card in/i)).not.toBeInTheDocument();
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
      expect(vi.mocked(saveSession)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              state: expect.objectContaining({
                stepStartedAt: expect.any(Number),
                hiddenSince: null,
              }),
            }),
          ]),
        }),
      );
    });
  });
});

describe("Baseline: due review card reveal → grade cycle", () => {
  it("reveals a due review card and transitions to session-complete after grading", async () => {
    const reviewCard: NameReviewCard = {
      ...FIXTURE_CARD,
      state: {
        stability: 5,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "1970-01-01", // always due regardless of test run date
        lastReview: "1970-01-01",
        firstSeen: "1970-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([reviewCard]);
    vi.mocked(loadSession).mockReturnValueOnce({ cards: [reviewCard], limits: DEFAULT_LIMITS });

    const user = userEvent.setup();
    render(<ReviewSession />);

    // Un-revealed state: Reveal button visible, name hidden.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
      expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
    });

    // After reveal: name visible, grade buttons shown.
    await user.click(screen.getByRole("button", { name: /reveal/i }));
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }

    // After grading Easy: session-complete screen.
    await user.click(screen.getByRole("button", { name: /easy/i }));
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /easy/i })).not.toBeInTheDocument();
  });
});

describe("Regression: learning-queue preemption during grading window (#196)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the revealed review card locked when a learning card becomes due mid-session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
    const now = Date.now();

    // Review card (already reviewed, due today) — the card the user reveals.
    const reviewCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      name: "Bulbasaur",
      state: {
        stability: 5,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-11",
        lastReview: "2026-05-06",
        firstSeen: "2026-05-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    // Learning card in its first step, due 100 ms from now.
    const learningCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 2,
      name: "Ivysaur",
      spriteUrl: "https://example.com/ivysaur.png",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new" as const,
        dueDate: "2026-05-11",
        lastReview: null,
        firstSeen: "2026-05-11",
        learningStep: 0,
        stepStartedAt: now - (LEARNING_STEPS_MS[0] - 100), // dueAt = now + 100 ms
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([reviewCard, learningCard]);
    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [reviewCard, learningCard],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // render() wraps in act, so useEffects (session load) are flushed synchronously.
    // Use a sync query — findByRole/waitFor poll via setTimeout, which is faked here.
    const revealBtn = screen.getByRole("button", { name: /reveal/i });

    // Click Reveal on the review card.
    act(() => { fireEvent.click(revealBtn); });

    // Advance past the learning card's dueAt to trigger the countdown setTimeout.
    await act(async () => { vi.advanceTimersByTime(200); });

    // The grade buttons must still be visible — the locked card has not been replaced.
    expect(screen.getByRole("button", { name: /easy/i })).toBeInTheDocument();

    // The review card's name must still be displayed, not the learning card's.
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.queryByText("Ivysaur")).not.toBeInTheDocument();

    // Grade the locked review card.
    act(() => { fireEvent.click(screen.getByRole("button", { name: /easy/i })); });
    vi.useRealTimers();

    // saveSession must record the review card (id 1) as graded, not the learning card.
    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              state: expect.objectContaining({ lastReview: "2026-05-11" }),
            }),
          ]),
        }),
      );
    });

    // The learning card (id 2) must remain in its learning step — it was not graded.
    const lastCallArg = vi.mocked(saveSession).mock.lastCall?.[0] as
      | { cards: { id: number; state: { learningStep: number | null } }[] }
      | undefined;
    const savedLearningCard = lastCallArg?.cards.find((c) => c.id === 2);
    expect(savedLearningCard?.state.learningStep).toBe(0);
  });
});

describe("Learn-ahead: 20-minute boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pulls a learning card forward when due in 19 min (within learn-ahead window)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-12T12:00:00Z"));
    const T = Date.now();

    // Relearning card: dueAt = T + 19 min.
    // stepMs = RELEARNING_STEPS_MS[0] = 600_000 (10 min)
    // stepStartedAt = T + 19*60_000 - 600_000 = T + 9*60_000
    const learningCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      state: {
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 0,
        lapses: 0,
        fsrsState: "relearning" as const,
        dueDate: "2026-05-12",
        lastReview: "2026-05-12",    // relearning (not new-card learning)
        firstSeen: "2026-05-01",
        learningStep: 0,
        stepStartedAt: T + 9 * 60_000, // dueAt = T + 9*60_000 + 600_000 = T + 19*60_000
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [learningCard],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // The card should be pulled forward and presented for review — Reveal button visible,
    // no countdown screen.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/next card in/i)).not.toBeInTheDocument();
  });

  it("shows countdown when learning card is due in 21 min (beyond learn-ahead window)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-12T12:00:00Z"));
    const T = Date.now();

    // Relearning card: dueAt = T + 21 min.
    // stepStartedAt = T + 21*60_000 - 600_000 = T + 11*60_000
    const learningCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      state: {
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 0,
        lapses: 0,
        fsrsState: "relearning" as const,
        dueDate: "2026-05-12",
        lastReview: "2026-05-12",
        firstSeen: "2026-05-01",
        learningStep: 0,
        stepStartedAt: T + 11 * 60_000, // dueAt = T + 11*60_000 + 600_000 = T + 21*60_000
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [learningCard],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // Too far in the future — should show countdown, not the card.
    await waitFor(() =>
      expect(screen.getByText(/next card in/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });
});

describe("QueueCounterRow: live queue counters", () => {
  it("renders New/Learning/Review labels during an active session", async () => {
    // 1 new card (fresh) + 1 learning card (already-due, pulled forward by learn-ahead)
    const newCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      name: "Bulbasaur",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new" as const,
        dueDate: "2026-05-12",
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    const learningCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 2,
      name: "Ivysaur",
      spriteUrl: "https://example.com/ivysaur.png",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new" as const,
        dueDate: "2026-05-12",
        lastReview: null,
        firstSeen: "2026-05-12",
        learningStep: 0,
        stepStartedAt: Date.now() - LEARNING_STEPS_MS[0], // already due
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    // Seed only needs the cards that are in the session (id 1 and 2 are not
    // both in the default mock; override to include both).
    mockSeedPokemon.mockReturnValue([newCard, learningCard]);
    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [newCard, learningCard],
      limits: DEFAULT_LIMITS,
    });

    render(<ReviewSession />);

    // Wait for session to load and render the queue counter row.
    await waitFor(() =>
      expect(screen.getByRole("status", { name: /queue counts/i })).toBeInTheDocument(),
    );
    const counterRow = screen.getByRole("status", { name: /queue counts/i });
    expect(counterRow).toHaveTextContent("New");
    expect(counterRow).toHaveTextContent("Learning");
    expect(counterRow).toHaveTextContent("Review");
    expect(counterRow).toHaveTextContent("1 New");
    expect(counterRow).toHaveTextContent("1 Learning");
  });
});

// ---------------------------------------------------------------------------
// Learning filters (#333)
// ---------------------------------------------------------------------------

describe("Practice scope (#333)", () => {
  it("default empty scope is a no-op — regression guard", async () => {
    // The default settings mock returns practiceScope { gens: [], types: [], presets: [] }.
    // The existing reveal-flow expectations should still hold: Reveal button is
    // visible and the empty-state branch is NOT rendered.
    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/no Pok[ée]mon match your scope/i),
    ).not.toBeInTheDocument();
  });

  it("renders an empty-state with a Clear scope CTA when scope excludes every fixture card", async () => {
    // Bulbasaur is Gen I (generation-i). Scope to Gen IX → zero match.
    // Scope is non-empty AND eligibility is empty, so the dedicated
    // empty-state branch fires (not the generic complete screen).
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
      playCryOnReveal: false,
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/no Pok[ée]mon match your scope/i),
      ).toBeInTheDocument();
    });

    // The empty-state must offer a way out — a "Clear scope" button.
    expect(screen.getByRole("button", { name: /clear scope/i })).toBeInTheDocument();
  });

  it("persists hiddenSince via saveSession when a graduated card is out of scope", async () => {
    // Graduated card (firstSeen + lastReview set, learningStep null). The
    // active scope excludes its species → reconcileHiddenState stamps
    // hiddenSince, and the session-load effect must persist that change so
    // it survives a reload.
    const graduatedCard: NameReviewCard = {
      ...FIXTURE_CARD,
      state: {
        stability: 5,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-20",
        lastReview: "2026-05-01",
        firstSeen: "2026-04-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([graduatedCard]);
    vi.mocked(loadSession).mockReturnValueOnce({
      cards: [graduatedCard],
      limits: DEFAULT_LIMITS,
    });
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
      playCryOnReveal: false,
      // Excludes Bulbasaur (Gen I).
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // saveSession must have been called with the reconciled card whose
    // hiddenSince is now a non-null ISO string.
    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              state: expect.objectContaining({
                hiddenSince: expect.any(String),
              }),
            }),
          ]),
        }),
      );
    });
  });
});
