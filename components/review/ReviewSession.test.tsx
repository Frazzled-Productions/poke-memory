import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReviewSession } from "@/components/review/ReviewSession";
import type { NameReviewCard, CryReviewCard } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import { STORAGE_KEY as DAILY_SUMMARY_KEY } from "@/lib/review/dailySummaryPersistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { CRY_ID_OFFSET } from "@/lib/pokemon/seed";
import { LEARNING_STEPS_MS, RELEARNING_STEPS_MS } from "@/lib/srs/constants";
import { nextReview } from "@/lib/srs/scheduler";

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

  function makeExtra(id: number, name: string, displayName?: string): typeof card {
    return { ...card, id, name, displayName: displayName ?? name, subjectKey: String(id), spriteUrl: `https://example.com/${name.toLowerCase()}.png` };
  }

  // Partial so individual tests can pass any subset of settings via
  // mockReturnValue without TS demanding the full UserSettings surface,
  // while still key-name-checking every field against UserSettings.
  const defaultSettings: Partial<UserSettings> = {
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

// loadSession / saveSession are vi.fn() so individual tests can override them
// with mockResolvedValueOnce; defaults simulate an empty session.
vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
}));

// Grade log operations are async (IDB-backed). Mock them so tests that use
// fake timers don't stall waiting for IDB microtasks to settle.
// `todayGradeSequence` keeps its real implementation — it is a pure helper
// over whatever array `loadGradeLog` is mocked to resolve, so tests can drive
// the Share-button reconstruction path (#896) by overriding loadGradeLog only.
vi.mock("@/lib/gradelog/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gradelog/persistence")>();
  return {
    loadGradeLog: vi.fn().mockResolvedValue([]),
    appendGradeEntry: vi.fn().mockResolvedValue({ occurredAt: Date.now() }),
    removeGradeEntry: vi.fn().mockResolvedValue(undefined),
    todayGradeSequence: actual.todayGradeSequence,
    GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
  };
});

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
  // OnboardingHint imports DEFAULT_ONBOARDING for its dismissal fallback.
  DEFAULT_ONBOARDING: {
    welcomeDismissed: false,
    practiceHintDismissed: false,
    statsHintDismissed: false,
    settingsHintDismissed: false,
    installNudgeDismissed: false,
    audioHintDismissed: false,
    cardTypesHintDismissed: false,
  },
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

const { mockWarmupTts, mockSpeakName } = vi.hoisted(() => ({
  mockWarmupTts: vi.fn(),
  mockSpeakName: vi.fn(),
}));

vi.mock("@/lib/audio/tts", () => ({
  warmupTts: mockWarmupTts,
  speakName: mockSpeakName,
  getPreferredVoice: vi.fn(() => null),
  voiceTier: vi.fn(() => "compact"),
  awaitTtsEnd: vi.fn(() => Promise.resolve()),
}));

// waitForAudio resolves immediately by default — audio timing is tested in its
// own dedicated test file (waitForAudio.test.ts in this directory).
vi.mock("@/lib/audio/waitForAudio", () => ({
  waitForAudio: vi.fn(() => Promise.resolve()),
}));

// Spy on nextReview using the real implementation by default — individual tests
// can override with mockImplementationOnce to inject errors.
vi.mock("@/lib/srs/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/srs/scheduler")>();
  return {
    ...actual,
    nextReview: vi.fn(actual.nextReview),
  };
});

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
    if (/dismiss hint/i.test(b.getAttribute("aria-label") ?? "")) return false;
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
  vi.mocked(loadSession).mockResolvedValue(null);
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

describe("ReviewSession onboarding nudges (#702)", () => {
  it("shows the audio hint at reveal when no audio feature is enabled", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    expect(
      screen.getByText(/hear Pokémon cries and names read aloud/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open audio settings/i }),
    ).toHaveAttribute("href", "/settings#audio-heading");
  });

  it("hides the audio hint when an audio feature is already on", async () => {
    const user = userEvent.setup();
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

    expect(
      screen.queryByText(/hear Pokémon cries and names read aloud/i),
    ).not.toBeInTheDocument();
  });

  it("shows the card-types hint on the session-complete screen", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/reverse cards, reverse-evolution cards/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open practice settings/i }),
    ).toHaveAttribute("href", "/settings#practice-heading");
  });

  it("shows the audio hint for reverse cards when no audio feature is enabled", async () => {
    // Reverse cards use SpritePicker and have no reveal step. The nudge must
    // appear immediately after the picker renders, not gated on a reveal click.
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
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
    });

    render(<ReviewSession />);

    // SpritePicker renders immediately (no reveal step).
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument(),
    );

    // The audio nudge must be visible without any reveal interaction.
    await waitFor(() =>
      expect(
        screen.getByText(/hear Pokémon cries and names read aloud/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: /open audio settings/i }),
    ).toHaveAttribute("href", "/settings#audio-heading");
  });

  it("hides the audio hint for reverse cards when an audio feature is already on", async () => {
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
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
      playCryOnReveal: true,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument(),
    );

    // playCryOnReveal is on → audioFeaturesOff is false → nudge must not appear.
    expect(
      screen.queryByText(/hear Pokémon cries and names read aloud/i),
    ).not.toBeInTheDocument();
  });

  it("hides the card-types hint when every card type is already on", async () => {
    // Empty seed → the session-complete screen renders immediately, so the
    // hint visibility is driven purely by the card-type settings.
    mockSeedPokemon.mockReturnValue([]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      reverseCardsEnabled: true,
      reverseEvolutionCardsEnabled: true,
      alternateFormsEnabled: true,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    render(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/reverse cards, reverse-evolution cards/i),
    ).not.toBeInTheDocument();
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

    vi.mocked(loadSession).mockResolvedValueOnce({
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

    vi.mocked(loadSession).mockResolvedValueOnce({
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
    vi.mocked(loadSession).mockResolvedValueOnce({ cards: [reviewCard], limits: DEFAULT_LIMITS });

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

describe("Regression: learning-card displaces current card before Reveal (#839)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the current card on screen when a learning card becomes due before Reveal is clicked", async () => {
    // Scenario: the user is looking at a review card on its front face
    // (Reveal not yet clicked). A learning card's dueAt passes and the
    // countdown setTimeout fires, triggering a re-render. Without the
    // displayedCardId lock the learning card would displace the current
    // card and the user's tap-in-progress would land on the wrong card.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    const now = Date.now();

    // Review card (due today) — the card currently on screen.
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
        dueDate: "2026-05-17",
        lastReview: "2026-05-12",
        firstSeen: "2026-05-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    // Learning card due in 150 ms — will fire its timeout before the user taps Reveal.
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
        dueDate: "2026-05-17",
        lastReview: null,
        firstSeen: "2026-05-17",
        learningStep: 0,
        stepStartedAt: now - (LEARNING_STEPS_MS[0] - 150), // dueAt = now + 150 ms
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([reviewCard, learningCard]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [reviewCard, learningCard],
      limits: DEFAULT_LIMITS,
    });

    await act(async () => { render(<ReviewSession />); });

    // Review card is on screen — Reveal button visible, name hidden.
    const revealBtn = screen.getByRole("button", { name: /reveal/i });
    expect(revealBtn).toBeInTheDocument();

    // Advance time past the learning card's dueAt WITHOUT clicking Reveal.
    // This fires the countdown setTimeout and triggers a re-render.
    await act(async () => { vi.advanceTimersByTime(300); });

    // The Reveal button must still be present — the review card was NOT displaced.
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    // Grade buttons must not be visible — we haven't revealed anything.
    expect(screen.queryByRole("button", { name: /easy/i })).not.toBeInTheDocument();

    // Reveal the card — confirm it is still the review card, not the learning card.
    act(() => { fireEvent.click(screen.getByRole("button", { name: /reveal/i })); });
    // The review card's name must be visible after reveal.
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.queryByText("Ivysaur")).not.toBeInTheDocument();
    // Grade buttons must now be present.
    expect(screen.getByRole("button", { name: /easy/i })).toBeInTheDocument();

    // Grade the review card using the same pattern as the #196 regression test:
    // click inside fake-timer mode, then switch to real timers so the async
    // handleGrade microtasks can settle and waitFor can poll.
    act(() => { fireEvent.click(screen.getByRole("button", { name: /easy/i })); });

    vi.useRealTimers();

    // The review card (id 1) must have been graded after the grade settles.
    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalledWith(
        expect.objectContaining({
          cards: expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              state: expect.objectContaining({ lastReview: "2026-05-17" }),
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
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [reviewCard, learningCard],
      limits: DEFAULT_LIMITS,
    });

    // Flush async effects (loadSession is now async) while still in fake-timer mode.
    await act(async () => { render(<ReviewSession />); });

    // loadSession resolved — component is out of the loading skeleton.
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

    vi.mocked(loadSession).mockResolvedValueOnce({
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

    vi.mocked(loadSession).mockResolvedValueOnce({
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
    vi.mocked(loadSession).mockResolvedValueOnce({
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
    vi.mocked(loadSession).mockResolvedValueOnce({
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

describe("Practice scope: Clear scope button (#835)", () => {
  it("re-computes eligibility including card-type check when scope is cleared", async () => {
    // Start with a scoped session that shows the empty-state screen. Clicking
    // "Clear scope" triggers handleScopeChange(EMPTY_SCOPE) with cards loaded,
    // covering the cardTypeOpts/cardTypeIsEnabled block inside that handler.
    const user = userEvent.setup();
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
      // Scope to Gen IX — Bulbasaur is Gen I, so zero match.
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // Wait for the empty-state screen with the Clear scope button.
    await waitFor(() => {
      expect(
        screen.getByText(/no Pok[ée]mon match your scope/i),
      ).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole("button", { name: /clear scope/i });
    expect(clearBtn).toBeInTheDocument();

    // Click Clear scope — this fires handleScopeChange with cards !== null.
    await user.click(clearBtn);

    // After clearing, the scope is empty and Bulbasaur is eligible again.
    // The Reveal button should now appear.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /reveal/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/no Pok[ée]mon match your scope/i),
    ).not.toBeInTheDocument();
  });
});

describe("ReviewSession TTS warm-up (#479)", () => {
  it("calls warmupTts on the first grade button click", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    const easyBtn = screen.getByRole("button", { name: /easy/i });
    await user.click(easyBtn);

    expect(mockWarmupTts).toHaveBeenCalledOnce();
  });

  it("warmupTts is called before the grade's saveSession call (synchronous in click handler)", async () => {
    const user = userEvent.setup();

    render(<ReviewSession />);

    // Wait for mount-time saveSession calls to settle, then start tracking.
    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    const callOrder: string[] = [];
    mockWarmupTts.mockImplementation(() => { callOrder.push("warmupTts"); });
    vi.mocked(saveSession).mockImplementation(async () => {
      callOrder.push("saveSession");
      return { ok: true };
    });

    const easyBtn = screen.getByRole("button", { name: /easy/i });
    await user.click(easyBtn);

    await waitFor(() => expect(callOrder).toContain("saveSession"));

    // warmupTts must have been recorded before saveSession is called —
    // it runs synchronously before the first await inside handleGrade.
    expect(callOrder.indexOf("warmupTts")).toBeLessThan(callOrder.indexOf("saveSession"));
  });
});

describe("Robustness: corrupt grade in handleGrade (#811)", () => {
  it("surfaces an error banner and leaves the session recoverable when nextReview throws", async () => {
    const user = userEvent.setup();
    render(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // Simulate a RangeError from nextReview (e.g. corrupt grade payload).
    vi.mocked(nextReview).mockImplementationOnce(() => {
      throw new RangeError("nextReview: invalid grade 3. Expected one of 1 (Again), 2 (Hard), 4 (Good), or 5 (Easy).");
    });

    // Grade buttons must be enabled before the click.
    const easyBtn = screen.getByRole("button", { name: /easy/i });
    expect(easyBtn).not.toBeDisabled();

    await user.click(easyBtn);

    // Error banner appears.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/this grade could not be saved/i),
    ).toBeInTheDocument();

    // Grade buttons are re-enabled — session is not frozen.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /easy/i })).not.toBeDisabled(),
    );

    // The user can dismiss the error (exact label to avoid matching "Dismiss hint" on onboarding hints).
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    await user.click(dismissBtn);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the error banner in the cry-card branch when nextReview throws", async () => {
    // Set up a session with cry cards enabled and name/evo limits zeroed out so
    // the cry render branch is the active card. nameCardsEnabled must remain true
    // so the "no card types enabled" guard does not fire before any card renders.
    mockSeedPokemon.mockReturnValue([{ ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" }]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
      nameCardsEnabled: true,
      evolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    const user = userEvent.setup();
    render(<ReviewSession />);

    // Cry branch shows a Reveal button (after the cry play tile).
    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    vi.mocked(nextReview).mockImplementationOnce(() => {
      throw new RangeError("nextReview: invalid grade 3. Expected one of 1 (Again), 2 (Hard), 4 (Good), or 5 (Easy).");
    });

    await user.click(screen.getByRole("button", { name: /easy/i }));

    // Error banner appears in the cry render branch.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByText(/this grade could not be saved/i)).toBeInTheDocument();

    // Session is not frozen — grade buttons are re-enabled.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /easy/i })).not.toBeDisabled(),
    );
  });

  it("renders the error banner in the reverse-card branch when nextReview throws", async () => {
    // Set up a session with only reverse cards enabled (name/evo limits zeroed) so
    // the reverse render branch is the active card.
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      reverseCardsEnabled: true,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    vi.useFakeTimers();
    render(<ReviewSession />);

    // Reverse branch shows sprite tile buttons — no Reveal step.
    await act(async () => { vi.advanceTimersByTime(0); });
    vi.useRealTimers();

    await waitFor(() => expect(getTileButtons()).toHaveLength(4));

    vi.mocked(nextReview).mockImplementationOnce(() => {
      throw new RangeError("nextReview: invalid grade 3. Expected one of 1 (Again), 2 (Hard), 4 (Good), or 5 (Easy).");
    });

    // Click the correct tile — the SpritePicker will call handleGrade(4).
    const group = screen.getByRole("group");
    const label = group.getAttribute("aria-label") ?? "";
    const match = label.match(/Which Pokémon is (.+)\?/);
    const targetName = match?.[1] ?? "";
    const correctTile = screen.getByRole("button", { name: targetName });

    vi.useFakeTimers();
    act(() => { fireEvent.click(correctTile); });
    await act(async () => { vi.advanceTimersByTime(700); });
    vi.useRealTimers();

    // Error banner appears in the reverse render branch.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByText(/this grade could not be saved/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card-type enable/disable guards (#835, #863)
// ---------------------------------------------------------------------------

describe("Card-type disable guards (#835)", () => {
  it("does NOT show 'No card types enabled' when only cry cards are enabled", async () => {
    // Regression guard for the all-disabled check omitting cryCardsEnabled.
    // With cry as the only enabled type the session must present a card,
    // not the "No card types enabled" dead-end.
    mockSeedPokemon.mockReturnValue([
      { ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" },
    ]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // The cry branch shows a Reveal button — the all-disabled guard must not fire.
    await waitFor(() => {
      expect(
        screen.queryByText(/no card types enabled/i),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /reveal/i }),
    ).toBeInTheDocument();
  });

  it("shows 'No card types enabled' when every type including cry is off", async () => {
    // Complementary positive case: all types disabled → dead-end message.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/no card types enabled/i),
      ).toBeInTheDocument();
    });
  });

  it("does not produce NEW_CARDS_LOCKED after a daily new-card cap is hit on a now-disabled type", async () => {
    // Scenario: name cards have hit their new-card cap (maxNewPerDay: 0 so any
    // name card in storage would trigger the wall), but the user has since
    // disabled name cards. Evolution cards are the active type, but the seed
    // has no evolution cards, so the queue is empty.
    //
    // Without the fix: hasMoreNewCardsOf("name") iterates `cards!` without
    // consulting eligibleCardIds → sees the unseen name card → returns true →
    // NEW_CARDS_LOCKED fires even though name cards are off.
    // With the fix: the name card is excluded from eligibleCardIds →
    // hasMoreNewCardsOf finds nothing → SESSION_COMPLETE.
    const unseenNameCard: NameReviewCard = {
      ...FIXTURE_CARD,
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new" as const,
        dueDate: "1970-01-01",
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([unseenNameCard]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [unseenNameCard],
      limits: DEFAULT_LIMITS,
    });
    // Name cards disabled; evolution cards enabled but seed has none.
    // maxNewPerDay: 0 ensures name cards would fire the new-card wall if seen.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 10,
      maxReviewsEvolutionPerDay: 50,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      nameCardsEnabled: false,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // With the fix, the disabled name card is excluded from eligibleCardIds and
    // therefore excluded from hasMoreNewCardsOf — SESSION_COMPLETE, not NEW_CARDS_LOCKED.
    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/new card limit reached/i),
    ).not.toBeInTheDocument();
  });

  it("produces NEW_CARDS_LOCKED when cry new-card cap is hit with unseen cry cards remaining (#867)", async () => {
    // Regression guard for resolveEndState omitting "cry" from the tuple.
    // With cry cards enabled and maxNewCryPerDay: 0, any unseen cry card should
    // trigger NEW_CARDS_LOCKED. Without the fix, the tuple ["name", "evolution",
    // "reverse"] never inspects the cry bucket and the session falls through to
    // SESSION_COMPLETE ("All caught up!") instead.
    //
    // How the cry card reaches hasMoreNewCardsOf: mockSeedPokemon returns a
    // species with a non-null cryUrl. Because no saved cry card (id CRY_ID_OFFSET+1)
    // exists in the stored session, hydrateSession appends a fresh CryReviewCard
    // via initialReviewState (lastReview: null). That card satisfies
    // hasMoreNewCardsOf("cry") — the newWall fires.
    const seedWithCry: NameReviewCard = {
      ...FIXTURE_CARD,
      cryUrl: "https://example.com/bulbasaur.ogg",
    };

    mockSeedPokemon.mockReturnValue([seedWithCry]);
    // Pass the seed as a saved name card (id 1). hydrateSession will NOT find
    // a saved cry card (id CRY_ID_OFFSET+1), so it appends a fresh unseen one.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [seedWithCry],
      limits: DEFAULT_LIMITS,
    });
    // Cry cards enabled but daily new-cry cap is 0 (already "hit").
    // Name/evo/reverse all disabled so cry is the only active type.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 100,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // With "cry" in the resolveEndState tuple, hasMoreNewCardsOf("cry") returns
    // true and the new-card cap fires correctly — showing the locked screen.
    await waitFor(() => {
      expect(screen.getByText(/new cards locked for today/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });

  it("produces REVIEW_SOFT_WALL when cry review cap is hit with due cry cards remaining (#867)", async () => {
    // Regression guard for the reviewWall tuple also including "cry".
    // With cry enabled and maxReviewsCryPerDay: 0, a cry card that is due for
    // review (lastReview set, dueDate <= today, learningStep null) must trigger
    // REVIEW_SOFT_WALL. Without "cry" in the tuple the check is skipped and the
    // session falls through to SESSION_COMPLETE instead.
    //
    // How the due cry card reaches hasMoreDueReviewsOf: we pass a saved
    // CryReviewCard (id CRY_ID_OFFSET+1) with lastReview set to a past date and
    // dueDate set to today. hydrateSession finds the matching saved card in
    // savedIds and refreshes its seed fields while preserving the state, so the
    // card enters cards[] with the review-due state intact.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));

    const seedWithCry: NameReviewCard = {
      ...FIXTURE_CARD,
      cryUrl: "https://example.com/bulbasaur.ogg",
    };

    // A cry card that has been seen before and is due today for review.
    const dueCryCard: CryReviewCard = {
      ...seedWithCry,
      id: CRY_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: "cry",
      subjectKey: "1",
      state: {
        stability: 5,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-17",
        lastReview: "2026-05-01",
        firstSeen: "2026-04-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    mockSeedPokemon.mockReturnValue([seedWithCry]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [dueCryCard],
      limits: DEFAULT_LIMITS,
    });
    // maxReviewsCryPerDay: 0 means reviewsDoneToday (0) >= cap (0) is true,
    // and hasMoreDueReviewsOf("cry") sees dueCryCard — REVIEW_SOFT_WALL fires.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      nameCardsEnabled: false,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    // With "cry" in the reviewWall tuple, hasMoreDueReviewsOf("cry") returns
    // true and the review cap fires — showing the soft-wall screen.
    await waitFor(() => {
      expect(screen.getByText(/daily review limit reached/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("Share today button persistence (#896)", () => {
  // A name card that has already graduated and is not due again until 2099 —
  // with no unseen cards in the seed, the session lands on SESSION_COMPLETE.
  function buildCompletedNameCard(): NameReviewCard {
    return {
      ...FIXTURE_CARD,
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 10,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2099-12-31",
        lastReview: "2026-01-01",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
  }

  function todayUtc(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(
      new Date(),
    );
  }

  // jsdom on this Node version does not ship localStorage out of the box, so
  // install an in-memory stub — matching the pattern in CollapsibleSection.test.tsx.
  function makeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k) => store.get(k) ?? null,
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => {
        store.delete(k);
      },
      setItem: (k, v) => {
        store.set(k, String(v));
      },
    };
  }

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("shows the Share today button on a fresh mount when a today-dated daily summary is persisted", async () => {
    const card = buildCompletedNameCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card], limits: DEFAULT_LIMITS });
    // A persisted daily-summary record dated today — the in-memory
    // sessionGradeSeq is empty on this fresh mount, so the button can only
    // appear if it hydrates from this persisted record.
    localStorage.setItem(
      DAILY_SUMMARY_KEY,
      JSON.stringify({
        date: todayUtc(),
        gradeSequence: [4, 5, 4],
        reviewed: 3,
        newCards: 1,
        mastered: 0,
      }),
    );

    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /share today/i }),
      ).toBeInTheDocument();
    });
  });

  it("reconstructs the Share today button from the grade log when no daily summary is persisted", async () => {
    const card = buildCompletedNameCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card], limits: DEFAULT_LIMITS });
    // No daily-summary record — but the durable grade log still has today's
    // grades, so the button must reconstruct from the log (#896).
    const today = todayUtc();
    vi.mocked(loadGradeLog).mockResolvedValue([
      { date: "2026-01-01", grade: 1, cardType: "name", occurredAt: 1 },
      { date: today, grade: 4, cardType: "name", occurredAt: 200 },
      { date: today, grade: 5, cardType: "reverse", occurredAt: 100 },
    ]);

    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /share today/i }),
      ).toBeInTheDocument();
    });
  });

  it("does not show the Share today button when neither the daily summary nor the grade log has today's grades", async () => {
    const card = buildCompletedNameCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card], limits: DEFAULT_LIMITS });
    // Grade log only has entries from a previous day — nothing to share today.
    vi.mocked(loadGradeLog).mockResolvedValue([
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: 1 },
    ]);

    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /share today/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Graduated-cards review queue hint (#880)", () => {
  function buildCompletedNameCard(): NameReviewCard {
    return {
      ...FIXTURE_CARD,
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 10,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2099-12-31",
        lastReview: "2026-01-01",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
  }

  it("shows the graduated-cards hint when more than one card direction is enabled", async () => {
    const card = buildCompletedNameCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card], limits: DEFAULT_LIMITS });
    // Default settings enable both name and evolution cards (2 directions).
    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/reviews surface only graduated cards/i),
    ).toBeInTheDocument();
  });

  it("hides the graduated-cards hint when only one card direction is enabled", async () => {
    const card = buildCompletedNameCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card], limits: DEFAULT_LIMITS });
    // Only name cards enabled — there is no other direction to explain.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      reverseCardsEnabled: false,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      nameCardsEnabled: true,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    render(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/reviews surface only graduated cards/i),
    ).not.toBeInTheDocument();
  });
});
