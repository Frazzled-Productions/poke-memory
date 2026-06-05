import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderWithIntl,
  renderJa,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@/components/test-utils/renderWithIntl";
import { ReviewSession } from "@/components/review/ReviewSession";
import type { NameReviewCard, CryReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";
import { saveSettings } from "@/lib/settings/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadGradeLog, appendGradeEntry } from "@/lib/gradelog/persistence";
import { STORAGE_KEY as DAILY_SUMMARY_KEY } from "@/lib/review/dailySummaryPersistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { CRY_ID_OFFSET } from "@/lib/pokemon/seed";
import { LEARNING_STEPS_MS, RELEARNING_STEPS_MS } from "@/lib/srs/constants";
import { nextReview } from "@/lib/srs/scheduler";
import { FEEDBACK_HOLD_MS } from "@/components/review/MultipleChoiceNameCard";
import { todayInTimezone } from "@/lib/utils/format-date";

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

// vi.mock factories are hoisted - define seed data via vi.hoisted so the
// factory closure can reference it before the module-level const is initialised.
const { FIXTURE_CARD, FIXTURE_CARDS_4, GRADUATED_REVERSE_CARD, mockSeedPokemon, mockLoadSettings } = vi.hoisted(() => {
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
      dueDate: "1970-01-01", // arbitrary - ignored by buildSession
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
  //
  // Name and reverse are always on since #1234. maxNewReversePerDay is set to 0
  // here so the single-card fixtures stay single-card (no reverse card queued).
  // Tests that specifically exercise the reverse flow override this to 10.
  const defaultSettings: Partial<UserSettings> = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: true,
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  // Graduated reverse card for Bulbasaur. Used alongside FIXTURE_CARD in
  // loadSession fixtures to prevent hydrateSession (reverseEnabled=true since
  // #1234) from adding a fresh unseen reverse card that would trigger newWall
  // with maxNewReversePerDay=0 (the default single-card fixture cap).
  // "Graduated" means lastReview !== null so hasMoreNewCardsOf("reverse") = false.
  const graduatedReverseCard = {
    ...card,
    cardType: "reverse" as const,
    id: 2_000_001,   // REVERSE_ID_OFFSET + speciesId 1
    pokemonId: 1,
    subjectKey: "1",
    state: {
      stability: 10,
      difficulty: 5,
      elapsedDays: 25,
      scheduledDays: 25,
      reps: 3,
      lapses: 0,
      fsrsState: "review" as const,
      dueDate: "2099-01-01", // far future - not due
      lastReview: "1970-01-01",
      firstSeen: "1970-01-01",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };

  return {
    FIXTURE_CARD: card,
    FIXTURE_CARDS_4: [card, makeExtra(2, "Ivysaur"), makeExtra(3, "Venusaur"), makeExtra(4, "Charmander")],
    GRADUATED_REVERSE_CARD: graduatedReverseCard,
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
// `todayGradeSequence` keeps its real implementation - it is a pure helper
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
  effectiveStreakDates: vi.fn((dates: string[]) => dates),
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

// waitForAudio resolves immediately by default - audio timing is tested in its
// own dedicated test file (waitForAudio.test.ts in this directory).
vi.mock("@/lib/audio/waitForAudio", () => ({
  waitForAudio: vi.fn(() => Promise.resolve()),
}));

// decodeSpriteUrls resolves immediately in the test environment (jsdom has no
// HTMLImageElement.decode). Mocking it here lets individual tests spy on calls
// without relying on the graceful-fallback path in the real implementation.
const { mockDecodeSpriteUrls } = vi.hoisted(() => ({
  mockDecodeSpriteUrls: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/sprites/decode", () => ({
  decodeSpriteUrls: mockDecodeSpriteUrls,
  DECODE_TIMEOUT_MS: 500,
  DECODE_GRADE_TIMEOUT_MS: 150,
}));

// Spy on nextReview using the real implementation by default - individual tests
// can override with mockImplementationOnce to inject errors.
// Expose the real function so tests that temporarily swap the implementation
// (e.g. the hasMastered transition test) can restore it cleanly.
const { realNextReview } = vi.hoisted(() => ({
  realNextReview: { current: null as null | ((...args: Parameters<typeof import("@/lib/srs/scheduler").nextReview>) => ReturnType<typeof import("@/lib/srs/scheduler").nextReview>) },
}));
vi.mock("@/lib/srs/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/srs/scheduler")>();
  realNextReview.current = actual.nextReview as typeof realNextReview.current;
  return {
    ...actual,
    nextReview: vi.fn(actual.nextReview),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Buttons rendered inside the SpritePicker - excludes the new Undo and
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
    // InfoButton (#1574) - queue-state explanation affordance, not a tile.
    if (b.getAttribute("aria-controls") === "queue-state-info") return false;
    return true;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default implementations that vi.clearAllMocks() wipes.
  mockDecodeSpriteUrls.mockResolvedValue(undefined);
  mockSeedPokemon.mockReturnValue([FIXTURE_CARD]);
  // Name and reverse are always on since #1234. maxNewReversePerDay: 0 keeps
  // single-card test fixtures working without introducing a reverse card.
  mockLoadSettings.mockReturnValue({
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: true,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
  });
  vi.mocked(loadSession).mockResolvedValue(null);
});


describe("ReviewSession reveal flow", () => {
  it("shows Reveal button and hides the Pokémon name before reveal", async () => {
    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
      expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
    });
  });

  it("shows name and grade buttons after clicking Reveal", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: true,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // playCry is now always invoked with (url, volume, onEnded?) - onEnded is undefined
    // when speakNameOnReveal is off, which is the default for this fixture.
    expect(mockPlayCry).toHaveBeenCalledWith("https://example.com/bulbasaur.ogg", 0.6, undefined);
  });

  it("advances to next card and resets reveal state after grading", async () => {
    // Pre-seed loadSession with a graduated reverse card so hydrateSession
    // (reverseEnabled=true since #1234) doesn't add a fresh unseen reverse card
    // that would trigger newWall with maxNewReversePerDay=0.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [FIXTURE_CARD, GRADUATED_REVERSE_CARD],
      limits: DEFAULT_LIMITS,
    });
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

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

describe("handleReveal decode-ahead (#930)", () => {
  /** Minimal EvolutionReviewCard fixture injected via loadSession. */
  const EVO_CARD = {
    cardType: "evolution" as const,
    id: 1_500_001,
    subjectKey: "1:2",
    preEvoId: 1,
    preEvoName: "Bulbasaur",
    preEvoSpriteUrl: "/sprites/pokemon/1.png",
    postEvoId: 2,
    postEvoName: "Ivysaur",
    postEvoSpriteUrl: "/sprites/pokemon/2.png",
    triggerPhrase: "at level 16",
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

  const REVERSE_EVO_CARD = {
    ...EVO_CARD,
    cardType: "reverse-evolution" as const,
    id: 2_500_001,
  };

  function settingsForEvoOnly() {
    return {
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    };
  }

  it("calls decodeSpriteUrls with the post-evo sprite URL before revealing an evolution card", async () => {
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [EVO_CARD],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue(settingsForEvoOnly());

    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // decodeSpriteUrls should have been called with only the revealed (post-evo)
    // sprite, not the pre-evo sprite that is always visible.
    expect(mockDecodeSpriteUrls).toHaveBeenCalledWith(["/sprites/pokemon/2.png"]);
  });

  it("calls decodeSpriteUrls with the pre-evo sprite URL before revealing a reverse-evolution card", async () => {
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [REVERSE_EVO_CARD],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...settingsForEvoOnly(),
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: true,
    });

    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // Reverse-evolution: hiddenSide="pre", so the pre-evo sprite is revealed.
    expect(mockDecodeSpriteUrls).toHaveBeenCalledWith(["/sprites/pokemon/1.png"]);
  });

  it("does not call decodeSpriteUrls on reveal for a name card", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // decodeSpriteUrls should not be called during the reveal of a name card - 
    // there is no hidden sprite flip, so no decode-ahead is needed.
    expect(mockDecodeSpriteUrls).not.toHaveBeenCalled();
  });

  it("reveals the answer after decode-ahead completes for an evolution card", async () => {
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [EVO_CARD],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue(settingsForEvoOnly());

    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // Grade buttons must appear after the reveal - confirming that setRevealed
    // was called after the decode-ahead resolved.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /again/i })).toBeInTheDocument();
    });
  });

  it("does not reveal the answer while decodeSpriteUrls is still pending", async () => {
    // Use a deferred promise so we can verify setRevealed has NOT fired while
    // the decode-ahead is still in flight, then resolve and confirm it fires.
    let resolveDecode: (() => void) | undefined;
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });
    mockDecodeSpriteUrls.mockImplementationOnce(() => decodePromise);

    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [EVO_CARD],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue(settingsForEvoOnly());

    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    // Fire the click without awaiting - the decode promise is still pending.
    const clickPromise = user.click(revealBtn);

    // Wait for decodeSpriteUrls to actually be called (handleReveal has started
    // and is awaiting the decode), then assert setRevealed has not fired yet.
    await waitFor(() => {
      expect(mockDecodeSpriteUrls).toHaveBeenCalledWith(["/sprites/pokemon/2.png"]);
    });
    expect(screen.queryByRole("button", { name: /again/i })).not.toBeInTheDocument();

    // Resolve the decode and wait for the full reveal flow to complete.
    await act(async () => { resolveDecode!(); });
    await clickPromise;

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /again/i })).toBeInTheDocument();
    });
  });
});

describe("ReviewSession onboarding nudges (#702)", () => {
  // Audio-feature hints were removed in #1103 (replaced by the first-visit
  // onboarding modal). Only the card-types nudge on the session-complete screen
  // remains - it is still rendered by EndOfSessionScreen.

  it("shows the card-types hint on the session-complete screen", async () => {
    // Pre-seed loadSession with a graduated reverse card so hydrateSession
    // (reverseEnabled=true since #1234) doesn't add a fresh unseen reverse card
    // that would trigger newWall with maxNewReversePerDay=0.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [FIXTURE_CARD, GRADUATED_REVERSE_CARD],
      limits: DEFAULT_LIMITS,
    });
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/reverse-evolution cards or alternate-form cards/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open practice settings/i }),
    ).toHaveAttribute("href", "/settings#practice-heading");
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
      reverseEvolutionCardsEnabled: true,
      alternateFormsEnabled: true,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    renderWithIntl(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/reverse cards, reverse-evolution cards/i),
    ).not.toBeInTheDocument();
  });
});

describe("ReviewSession reverse card flow", () => {
  // Name and reverse are always on since #1234. Set maxNewPerDay: 0 and
  // evolutionCardsEnabled: false so only reverse cards appear as new cards.
  const reverseSettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 0,
    maxReviewsPerDay: 0,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
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
    renderWithIntl(<ReviewSession />);

    // 4 sprite tile buttons are rendered - no Reveal button.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
      expect(getTileButtons()).toHaveLength(4);
    });

    // The name prompt is shown (from SpritePicker's group aria-label).
    const targetName = getTargetName();
    expect(["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"]).toContain(targetName);
  });

  it("correct tile tap grades Good and advances to the next card", async () => {
    renderWithIntl(<ReviewSession />);
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
    renderWithIntl(<ReviewSession />);
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
      stepStartedAt: null, // migration gap - no start time recorded
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

    renderWithIntl(<ReviewSession />);

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

    renderWithIntl(<ReviewSession />);

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
    // Include a graduated reverse card so hydrateSession (reverseEnabled=true since
    // #1234) doesn't add a fresh unseen reverse card that would trigger newWall.
    vi.mocked(loadSession).mockResolvedValueOnce({ cards: [reviewCard, GRADUATED_REVERSE_CARD], limits: DEFAULT_LIMITS });

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

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

    // Review card (due today) - the card currently on screen.
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

    // Learning card due in 150 ms - will fire its timeout before the user taps Reveal.
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

    await act(async () => { renderWithIntl(<ReviewSession />); });

    // Review card is on screen - Reveal button visible, name hidden.
    const revealBtn = screen.getByRole("button", { name: /reveal/i });
    expect(revealBtn).toBeInTheDocument();

    // Advance time past the learning card's dueAt WITHOUT clicking Reveal.
    // This fires the countdown setTimeout and triggers a re-render.
    await act(async () => { vi.advanceTimersByTime(300); });

    // The Reveal button must still be present - the review card was NOT displaced.
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    // Grade buttons must not be visible - we haven't revealed anything.
    expect(screen.queryByRole("button", { name: /easy/i })).not.toBeInTheDocument();

    // Reveal the card - confirm it is still the review card, not the learning card.
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

    // The learning card (id 2) must remain in its learning step - it was not graded.
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

    // Review card (already reviewed, due today) - the card the user reveals.
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
    await act(async () => { renderWithIntl(<ReviewSession />); });

    // loadSession resolved - component is out of the loading skeleton.
    const revealBtn = screen.getByRole("button", { name: /reveal/i });

    // Click Reveal on the review card.
    act(() => { fireEvent.click(revealBtn); });

    // Advance past the learning card's dueAt to trigger the countdown setTimeout.
    await act(async () => { vi.advanceTimersByTime(200); });

    // The grade buttons must still be visible - the locked card has not been replaced.
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

    // The learning card (id 2) must remain in its learning step - it was not graded.
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

    renderWithIntl(<ReviewSession />);

    // The card should be pulled forward and presented for review - Reveal button visible,
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

    renderWithIntl(<ReviewSession />);

    // Too far in the future - should show countdown, not the card.
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

    renderWithIntl(<ReviewSession />);

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
  it("default empty scope is a no-op - regression guard", async () => {
    // The default settings mock returns practiceScope { gens: [], types: [], presets: [] }.
    // The existing reveal-flow expectations should still hold: Reveal button is
    // visible and the empty-state branch is NOT rendered.
    renderWithIntl(<ReviewSession />);

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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/no Pok[ée]mon match your scope/i),
      ).toBeInTheDocument();
    });

    // The empty-state must offer a way out - a "Clear scope" button.
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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      // Excludes Bulbasaur (Gen I).
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      // Scope to Gen IX - Bulbasaur is Gen I, so zero match.
      practiceScope: { gens: [9], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // Wait for the empty-state screen with the Clear scope button.
    await waitFor(() => {
      expect(
        screen.getByText(/no Pok[ée]mon match your scope/i),
      ).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole("button", { name: /clear scope/i });
    expect(clearBtn).toBeInTheDocument();

    // Click Clear scope - this fires handleScopeChange with cards !== null.
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

describe("Practice scope: stale display lock clears on scope change (#1088)", () => {
  it("changing scope before any grade updates the displayed card to the new queue head", async () => {
    // Repro for #1088: the displayedCardId ref locks the on-screen card from
    // the first render until a grade fires. Before the fix, handleScopeChange
    // updated eligibleCardIds but never released the lock, so the rendered
    // card stayed frozen on the pre-scope-change pick even when the new scope
    // excluded it.
    const user = userEvent.setup();

    // Two Gen-spanning fixtures so a single-gen scope toggle excludes exactly
    // one of them. Bulbasaur (id 1, speciesId 1) is Gen I; Chikorita (id 152,
    // speciesId 152) is Gen II. Both are new cards (firstSeen: null), so they
    // surface in the new-card queue without any persisted state needed.
    const bulbasaur: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      speciesId: 1,
      name: "Bulbasaur",
      displayName: "Bulbasaur",
      subjectKey: "1",
      spriteUrl: "https://example.com/bulbasaur.png",
      generation: "generation-i",
    };
    const chikorita: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 152,
      speciesId: 152,
      name: "Chikorita",
      displayName: "Chikorita",
      subjectKey: "152",
      spriteUrl: "https://example.com/chikorita.png",
      generation: "generation-ii",
    };
    mockSeedPokemon.mockReturnValue([bulbasaur, chikorita]);

    // Empty scope at mount, so eligibility includes both cards and either
    // can be the queue head depending on the stable-shuffle order. Whichever
    // shows first, scoping to the OTHER gen must release the lock and swap.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // Find the answer-hidden sprite. The preloader uses alt="", so this alt
    // is unique to the on-screen card.
    const initialSprite = await screen.findByAltText(
      "A Pokémon sprite, answer hidden",
    );
    const initialSrc = initialSprite.getAttribute("src") ?? "";
    expect(initialSrc).toMatch(/(bulbasaur|chikorita)\.png/);
    const initialIsBulbasaur = /bulbasaur\.png/.test(initialSrc);

    // Open the Scope panel. The collapsed toggle has aria-expanded="false";
    // expanding it exposes #scope-panel and the per-generation pills.
    const scopeToggle = screen
      .getAllByRole("button", { expanded: false })
      .find((b) => /scope/i.test(b.textContent ?? ""));
    expect(scopeToggle).toBeDefined();
    await user.click(scopeToggle!);

    // Pick the generation that EXCLUDES whatever's currently displayed:
    // if Bulbasaur is on screen, click "Generation II"; otherwise click "Generation I".
    // Each pill carries an aria-label of the form "Generation <Roman>".
    const excludingGen = initialIsBulbasaur ? "Generation II" : "Generation I";
    const genPill = screen.getByRole("button", { name: excludingGen });
    await user.click(genPill);

    // The displayed sprite must swap to the remaining in-scope card. Before
    // the fix this stayed pinned on the initially-displayed card because the
    // displayedCardId lock was never released by handleScopeChange.
    await waitFor(() => {
      const sprite = screen.getByAltText("A Pokémon sprite, answer hidden");
      const src = sprite.getAttribute("src") ?? "";
      const expected = initialIsBulbasaur ? "chikorita.png" : "bulbasaur.png";
      expect(src).toContain(expected);
    });
  });

  it("changing scope to an empty set immediately renders the no-match empty state", async () => {
    // Companion check for the third acceptance criterion: with the lock
    // cleared on scope change, scoping to a no-match set must surface the
    // empty-state immediately rather than staying frozen on a now out-of-scope
    // card. Uses a fictitious type string with no seed matches.
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue([FIXTURE_CARD]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);
    await screen.findByAltText("A Pokémon sprite, answer hidden");

    const scopeToggle = screen
      .getAllByRole("button", { expanded: false })
      .find((b) => /scope/i.test(b.textContent ?? ""));
    await user.click(scopeToggle!);

    // Bulbasaur is Gen I, so scoping to Gen IX excludes it. The empty-state
    // must appear without any intervening grade.
    const genIX = screen.getByRole("button", { name: "Generation IX" });
    await user.click(genIX);

    await waitFor(() => {
      expect(
        screen.getByText(/no Pok[ée]mon match your scope/i),
      ).toBeInTheDocument();
    });
  });
});

describe("ReviewSession TTS warm-up (#479)", () => {
  it("calls warmupTts on the reveal button click and again on the grade button click", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);

    // warmupTts fires on the reveal gesture too (gesture-context warm-up must
    // happen synchronously before any await in handleReveal, same as in
    // handleGrade - see fix for #946).
    expect(mockWarmupTts).toHaveBeenCalledOnce();

    mockWarmupTts.mockClear();

    const easyBtn = screen.getByRole("button", { name: /easy/i });
    await user.click(easyBtn);

    expect(mockWarmupTts).toHaveBeenCalledOnce();
  });

  it("warmupTts is called before the grade's saveSession call (synchronous in click handler)", async () => {
    const user = userEvent.setup();

    renderWithIntl(<ReviewSession />);

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

    // warmupTts must have been recorded before saveSession is called - 
    // it runs synchronously before the first await inside handleGrade.
    expect(callOrder.indexOf("warmupTts")).toBeLessThan(callOrder.indexOf("saveSession"));
  });
});

describe("Robustness: corrupt grade in handleGrade (#811)", () => {
  it("surfaces an error banner and leaves the session recoverable when nextReview throws", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

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

    // Grade buttons are re-enabled - session is not frozen.
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
    // the cry render branch is the active card. maxNewPerDay is set to 0 so
    // no name cards enter the queue and cry is the only active card type.
    mockSeedPokemon.mockReturnValue([{ ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" }]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
      evolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

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

    // Session is not frozen - grade buttons are re-enabled.
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
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    vi.useFakeTimers();
    renderWithIntl(<ReviewSession />);

    // Reverse branch shows sprite tile buttons - no Reveal step.
    await act(async () => { vi.advanceTimersByTime(0); });
    vi.useRealTimers();

    await waitFor(() => expect(getTileButtons()).toHaveLength(4));

    vi.mocked(nextReview).mockImplementationOnce(() => {
      throw new RangeError("nextReview: invalid grade 3. Expected one of 1 (Again), 2 (Hard), 4 (Good), or 5 (Easy).");
    });

    // Click the correct tile - the SpritePicker will call handleGrade(4).
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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // The cry branch shows a Reveal button - the all-disabled guard must not fire.
    await waitFor(() => {
      expect(
        screen.queryByText(/no card types enabled/i),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /reveal/i }),
    ).toBeInTheDocument();
  });

  it("never shows 'No card types enabled' because reverse is always on (#1234)", async () => {
    // Since #1234, reverse cards are always enabled (reverseEnabled is hardcoded
    // true in ReviewSession). The "No card types enabled" guard requires all of
    // evolution, reverse, reverse-evolution, and cry to be off - an unreachable
    // combination. Even with every opt-in type disabled, the session still builds
    // reverse cards from the fixture seed and renders a Reveal button.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // Reverse cards are queued - the guard never fires.
    await waitFor(() => {
      expect(
        screen.queryByText(/no card types enabled/i),
      ).not.toBeInTheDocument();
    });
  });

  it("does not produce NEW_CARDS_LOCKED when cry is capped and disabled (#835)", async () => {
    // Scenario: cry new-card cap is 0 but cry cards are disabled (cryCardsEnabled=false).
    // An unseen cry card in the session would naively trigger the wall, but
    // hasMoreNewCardsOf checks cardTypeIsEnabled first - since cry is off, the
    // cry card is excluded → SESSION_COMPLETE.
    //
    // Seed pokemon has a cryUrl so buildSession/hydrateSession generates a cry card.
    // Name + reverse: name card is graduated, reverse card is graduated so those
    // queues are empty. Evolution: enabled but seed has no evo cards.
    // The cry card is the only unseen card, but cry is off → no wall.
    const seedWithCry: NameReviewCard = {
      ...FIXTURE_CARD,
      cryUrl: "https://example.com/bulbasaur.ogg",
    };
    const graduatedNameCard: NameReviewCard = {
      ...FIXTURE_CARD,
      cryUrl: "https://example.com/bulbasaur.ogg",
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 25,
        scheduledDays: 25,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2099-01-01",
        lastReview: "1970-01-01",
        firstSeen: "1970-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
    // Cry card (unseen) - id = CRY_ID_OFFSET + 1 = 3_000_001
    const unseenCryCard = {
      ...seedWithCry,
      cardType: "cry" as const,
      id: 3_000_001,
      pokemonId: 1,
      subjectKey: "1",
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

    mockSeedPokemon.mockReturnValue([seedWithCry]);
    vi.mocked(loadSession).mockResolvedValueOnce({
      // Graduated name + reverse; unseen cry card
      cards: [graduatedNameCard, GRADUATED_REVERSE_CARD, unseenCryCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 10,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false, // ← cry disabled
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // Cry card is excluded from hasMoreNewCardsOf because cryCardsEnabled=false.
    // All other queues are empty → SESSION_COMPLETE, not NEW_CARDS_LOCKED.
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
    // hasMoreNewCardsOf("cry") - the newWall fires.
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
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 100,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // With "cry" in the resolveEndState tuple, hasMoreNewCardsOf("cry") returns
    // true and the new-card cap fires correctly - showing the locked screen.
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
    // and hasMoreDueReviewsOf("cry") sees dueCryCard - REVIEW_SOFT_WALL fires.
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // With "cry" in the reviewWall tuple, hasMoreDueReviewsOf("cry") returns
    // true and the review cap fires - showing the soft-wall screen.
    await waitFor(() => {
      expect(screen.getByText(/daily review limit reached/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("Share today button persistence (#896)", () => {
  // A name card that has already graduated and is not due again until 2099 - 
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

  /**
   * Graduated reverse card for species 1 (Bulbasaur). Pre-seeding loadSession
   * with both the name and reverse card prevents hydrateSession from appending
   * a fresh unseen reverse card that would drive NEW_CARDS_LOCKED instead of
   * SESSION_COMPLETE. Required since #1234 made reverse always-on.
   */
  function buildCompletedReverseCard(): ReverseReviewCard {
    return {
      ...buildCompletedNameCard(),
      id: 2_000_001,          // REVERSE_ID_OFFSET + speciesId 1
      pokemonId: 1,
      cardType: "reverse",
      subjectKey: "1",
    } as unknown as ReverseReviewCard;
  }

  // Use todayInTimezone from lib/utils/format-date to avoid raw Intl.DateTimeFormat
  // calls in components/tests - banned by the #1456 lint rule.
  function todayUtc(): string {
    return todayInTimezone("UTC");
  }

  // jsdom on this Node version does not ship localStorage out of the box, so
  // install an in-memory stub - matching the pattern in CollapsibleSection.test.tsx.
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
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([card]);
    // Both name and reverse are graduated - hydrateSession won't add an unseen
    // reverse card that would drive NEW_CARDS_LOCKED instead of SESSION_COMPLETE.
    vi.mocked(loadSession).mockResolvedValue({ cards: [card, reverseCard], limits: DEFAULT_LIMITS });
    // A persisted daily-summary record dated today - the in-memory
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

    renderWithIntl(<ReviewSession />);

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
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card, reverseCard], limits: DEFAULT_LIMITS });
    // No daily-summary record - but the durable grade log still has today's
    // grades, so the button must reconstruct from the log (#896).
    const today = todayUtc();
    vi.mocked(loadGradeLog).mockResolvedValue([
      { date: "2026-01-01", grade: 1, cardType: "name", occurredAt: 1 },
      { date: today, grade: 4, cardType: "name", occurredAt: 200 },
      { date: today, grade: 5, cardType: "reverse", occurredAt: 100 },
    ]);

    renderWithIntl(<ReviewSession />);

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
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([card]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [card, reverseCard], limits: DEFAULT_LIMITS });
    // Grade log only has entries from a previous day - nothing to share today.
    vi.mocked(loadGradeLog).mockResolvedValue([
      { date: "2026-01-01", grade: 4, cardType: "name", occurredAt: 1 },
    ]);

    renderWithIntl(<ReviewSession />);

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

  /**
   * Graduated reverse card paired with buildCompletedNameCard().
   * Pre-seeding loadSession with both prevents hydrateSession from appending a
   * fresh unseen reverse card (id 2_000_001), which would cause the session to
   * show the SpritePicker instead of the end-of-session screen.
   */
  function buildCompletedReverseCard(): ReverseReviewCard {
    return {
      ...buildCompletedNameCard(),
      id: 2_000_001,        // REVERSE_ID_OFFSET + speciesId 1
      pokemonId: 1,
      cardType: "reverse",
      subjectKey: "1",
    } as unknown as ReverseReviewCard;
  }

  it("shows the graduated-cards hint when more than one card direction is enabled", async () => {
    // Since #1234, name and reverse are always on (2 directions minimum), so the
    // hint must always show when the session completes.
    const nameCard = buildCompletedNameCard();
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([nameCard]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [nameCard, reverseCard], limits: DEFAULT_LIMITS });
    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/reviews surface only graduated cards/i),
    ).toBeInTheDocument();
  });

  it("hint shows with name+reverse even when evolution and cry are off (#1234)", async () => {
    // Since #1234, name and reverse are always on so enabledDirections is always
    // at least 2 - the hint must show regardless of the optional card types.
    const nameCard = buildCompletedNameCard();
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([nameCard]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [nameCard, reverseCard], limits: DEFAULT_LIMITS });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    // name + reverse = 2 directions → hint must show.
    expect(
      screen.getByText(/reviews surface only graduated cards/i),
    ).toBeInTheDocument();
  });

  it("hint shows when name, reverse, and reverse-evolution are all on (#880 regression guard)", async () => {
    // Regression guard for #880: reverse-evolution was previously omitted from
    // the direction count. Verify it is counted alongside name and reverse.
    const nameCard = buildCompletedNameCard();
    const reverseCard = buildCompletedReverseCard();
    mockSeedPokemon.mockReturnValue([nameCard]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [nameCard, reverseCard], limits: DEFAULT_LIMITS });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 10,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 5,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: true,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
    // name + reverse + reverse-evolution = 3 directions → hint must show.
    expect(
      screen.getByText(/reviews surface only graduated cards/i),
    ).toBeInTheDocument();
  });
});

describe("EndOfSessionScreen unification - share button and due-tomorrow on every variant (#926 #914)", () => {
  // A graduated name card that is not due until 2099 - safe base for all variants.
  function buildCompletedCard(): NameReviewCard {
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

  // Use todayInTimezone from lib/utils/format-date to avoid raw Intl.DateTimeFormat
  // calls in components/tests - banned by the #1456 lint rule.
  function todayUtc(): string {
    return todayInTimezone("UTC");
  }

  function makeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k) => store.get(k) ?? null,
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => { store.delete(k); },
      setItem: (k, v) => { store.set(k, String(v)); },
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

  it("shows the Share today button on the NEW_CARDS_LOCKED variant when a today-dated summary is persisted (#926)", async () => {
    // One completed card (Bulbasaur) + one unseen card (Ivysaur). With
    // maxNewPerDay: 0 the new card is locked, landing on NEW_CARDS_LOCKED.
    const completed = buildCompletedCard();
    const unseen: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 2,
      name: "Ivysaur",
      displayName: "Ivysaur",
      subjectKey: "2",
      state: {
        ...FIXTURE_CARD.state,
        lastReview: null,
        firstSeen: null,
      },
    };
    mockSeedPokemon.mockReturnValue([completed, unseen]);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [completed, unseen],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    // Seed a persisted daily summary so `sessionGradeSeq` hydrates at mount.
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

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/new cards locked for today/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /share today/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows the due-tomorrow teaser on the NEW_CARDS_LOCKED variant when cards are due tomorrow (#914)", async () => {
    // Only fake Date - leaving setTimeout/setInterval real so waitFor works.
    vi.useFakeTimers({ toFake: ["Date"] });
    // Fix "today" to 2026-05-17 UTC so "tomorrow" is 2026-05-18.
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));

    const completed = buildCompletedCard();
    // A second card due tomorrow (2026-05-18) - makes dueTomorrow === 1.
    const dueTomorrowCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 2,
      name: "Ivysaur",
      displayName: "Ivysaur",
      subjectKey: "2",
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 10,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-18",
        lastReview: "2026-04-27",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
    // Third card unseen - drives NEW_CARDS_LOCKED when new cap is 0.
    const unseen: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 3,
      name: "Venusaur",
      displayName: "Venusaur",
      subjectKey: "3",
      state: {
        ...FIXTURE_CARD.state,
        lastReview: null,
        firstSeen: null,
      },
    };
    mockSeedPokemon.mockReturnValue([completed, dueTomorrowCard, unseen]);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [completed, dueTomorrowCard, unseen],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 50,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/new cards locked for today/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/1 card due tomorrow/i)).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("shows the Share today button on the REVIEW_SOFT_WALL variant when a today-dated summary is persisted (#952)", async () => {
    // One card due for review (lastReview set to a past date, dueDate <= today)
    // with maxReviewsPerDay: 0 - the cap is already hit at 0, reviewsDoneToday
    // starts at 0 (0 >= 0), and hasMoreDueReviewsOf sees the due card, so the
    // session lands on REVIEW_SOFT_WALL. A persisted daily summary triggers the
    // share button.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));

    const dueReviewCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      name: "Bulbasaur",
      displayName: "Bulbasaur",
      subjectKey: "1",
      state: {
        stability: 5,
        difficulty: 5,
        elapsedDays: 5,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-17",
        lastReview: "2026-05-01",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
    mockSeedPokemon.mockReturnValue([dueReviewCard]);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [dueReviewCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });
    // Seed a persisted daily summary so `sessionGradeSeq` hydrates at mount.
    localStorage.setItem(
      DAILY_SUMMARY_KEY,
      JSON.stringify({
        date: "2026-05-17",
        gradeSequence: [4, 5, 4],
        reviewed: 3,
        newCards: 1,
        mastered: 0,
      }),
    );

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/daily review limit reached/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /share today/i }),
      ).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("shows the due-tomorrow teaser on the REVIEW_SOFT_WALL variant when cards are due tomorrow (#952)", async () => {
    // Fix "today" to 2026-05-17 UTC so "tomorrow" is 2026-05-18.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));

    // A card due for review today - triggers hasMoreDueReviewsOf with the
    // review cap at 0, landing on REVIEW_SOFT_WALL.
    const dueReviewCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 1,
      name: "Bulbasaur",
      displayName: "Bulbasaur",
      subjectKey: "1",
      state: {
        stability: 5,
        difficulty: 5,
        elapsedDays: 5,
        scheduledDays: 5,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-17",
        lastReview: "2026-05-01",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
    // A second card due tomorrow - makes dueTomorrow === 1.
    const dueTomorrowCard: NameReviewCard = {
      ...FIXTURE_CARD,
      id: 2,
      name: "Ivysaur",
      displayName: "Ivysaur",
      subjectKey: "2",
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 10,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-18",
        lastReview: "2026-04-27",
        firstSeen: "2026-01-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };
    mockSeedPokemon.mockReturnValue([dueReviewCard, dueTomorrowCard]);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [dueReviewCard, dueTomorrowCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/daily review limit reached/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/1 card due tomorrow/i)).toBeInTheDocument();
    });

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts (#1060)
// ---------------------------------------------------------------------------

describe("Keyboard shortcuts (#1060)", () => {
  // Helper: fire a keydown event on document (bubbles up to window listeners).
  function pressKey(key: string, extras?: Partial<KeyboardEventInit>) {
    fireEvent.keyDown(document, { key, bubbles: true, ...extras });
  }

  it("Space reveals the card when no text input is focused", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey(" ");

    await waitFor(() => {
      expect(screen.getByRole("group", { name: /grade your answer/i })).toBeInTheDocument();
    });
  });

  it("Enter reveals the card when no text input is focused", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey("Enter");

    await waitFor(() => {
      expect(screen.getByRole("group", { name: /grade your answer/i })).toBeInTheDocument();
    });
  });

  it("grade key 1 (Again) is ignored before reveal", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey("1");

    // Grade buttons must not appear.
    expect(screen.queryByRole("group", { name: /grade your answer/i })).not.toBeInTheDocument();
    // Reveal button is still present.
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
  });

  it("grade key 1 (Again) fires after reveal", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    // Reveal via Space.
    pressKey(" ");
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /grade your answer/i })).toBeInTheDocument();
    });

    // Press 1 - Again grades the card.
    pressKey("1");

    await waitFor(() => {
      // Again re-queues the card in learning; Reveal reappears.
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
  });

  it("grade key 5 (Easy) fires after reveal and completes the session", async () => {
    // Pre-seed loadSession with a graduated reverse card so hydrateSession
    // (reverseEnabled=true since #1234) doesn't add a fresh unseen reverse card
    // that would trigger newWall with maxNewReversePerDay=0.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [FIXTURE_CARD, GRADUATED_REVERSE_CARD],
      limits: DEFAULT_LIMITS,
    });
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey(" ");
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /grade your answer/i })).toBeInTheDocument();
    });

    // Grade Easy (5) - for a brand-new card Easy graduates immediately with no
    // learning step, so the session completes after the only card is graded.
    pressKey("5");

    await waitFor(() => {
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });
  });

  it("Space is ignored while an <input> element is focused", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    // Inject a text input and focus it (simulates a search or settings field).
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey(" ");

    // Grade group must NOT appear because isTextInputFocused() returns true.
    expect(screen.queryByRole("group", { name: /grade your answer/i })).not.toBeInTheDocument();

    document.body.removeChild(input);
  });

  it("? key opens the keyboard shortcuts overlay", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey("?");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });
  });

  it("? key opens overlay before card is revealed", async () => {
    // The overlay must be accessible at any point in the review cycle, not only
    // after the card has been flipped (regression guard for the fix in #1069).
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });
    // Card is NOT yet revealed.
    expect(screen.queryByRole("group", { name: /grade your answer/i })).not.toBeInTheDocument();

    pressKey("?");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });
  });

  it("Escape closes the keyboard shortcuts overlay", async () => {
    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    pressKey("?");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });

    pressKey("Escape");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// ReviewCardLayout extraction regression (#1106)
//
// Verifies that the shared chrome (QueueCounterRow, undo button) is present
// in all four render paths after the extraction. Each test drives a specific
// branch by controlling settings / loadSession, then asserts the chrome
// elements that ReviewCardLayout now owns appear on screen.
// ---------------------------------------------------------------------------

describe("ReviewCardLayout shared chrome (#1106)", () => {
  /** Settings for a name-only session (the default flip branch). */
  const flipSettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 0,
    cryCardsEnabled: false,
    maxNewCryPerDay: 0,
    maxReviewsCryPerDay: 0,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
  };

  // jsdom on this Node version does not ship localStorage out of the box.
  // Install a fresh in-memory stub before each test so localStorage-touching
  // code paths (saveDailySummary, writeHasMasteredFlag) do not throw and can
  // be asserted against.
  function makeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k) => store.get(k) ?? null,
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => { store.delete(k); },
      setItem: (k, v) => { store.set(k, String(v)); },
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
    vi.useRealTimers();
  });

  it("flip branch (name card): QueueCounterRow is present", async () => {
    renderWithIntl(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByRole("status", { name: /queue counts/i })).toBeInTheDocument(),
    );
  });

  it("flip branch (name card): undo button appears after grading", async () => {
    const user = userEvent.setup();
    mockLoadSettings.mockReturnValue(flipSettings);
    renderWithIntl(<ReviewSession />);

    const reveal = await screen.findByRole("button", { name: /reveal/i });
    await user.click(reveal);
    // Grade Again (non-graduating) so the card re-enters the learning queue
    // and the session continues, keeping ReviewCardLayout mounted with the
    // undo button visible.
    await user.click(screen.getByRole("button", { name: /again/i }));

    // ReviewCardLayout wires the undo button; assert it is actually in the DOM.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /undo last grade/i }),
      ).toBeInTheDocument(),
    );
  });

  it("flip branch (name card): undo button disappears after clicking Undo (#1191 ref-based snapshot)", async () => {
    const user = userEvent.setup();
    mockLoadSettings.mockReturnValue(flipSettings);
    renderWithIntl(<ReviewSession />);

    const reveal = await screen.findByRole("button", { name: /reveal/i });
    await user.click(reveal);
    // Grade Again so the card stays in the session.
    await user.click(screen.getByRole("button", { name: /again/i }));

    // Wait for the undo button to appear (snapshot populated).
    const undoBtn = await screen.findByRole("button", { name: /undo last grade/i });

    // Click Undo - the ref-based snapshot should be consumed and the button removed.
    await user.click(undoBtn);

    // After undo the card is back in its revealed state (setRevealed(true) is
    // called during undo) so the grade buttons are visible, not the Reveal prompt.
    await screen.findByRole("group", { name: /grade your answer/i });
    // The undo button should now be gone.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /undo last grade/i })).not.toBeInTheDocument(),
    );
  });

  it("reverse branch (SpritePicker): QueueCounterRow is present", async () => {
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByRole("status", { name: /queue counts/i })).toBeInTheDocument(),
    );
    // Reverse branch: no Reveal button (SpritePicker grades inline).
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });

  it("cry branch: QueueCounterRow is present before reveal", async () => {
    mockSeedPokemon.mockReturnValue([
      { ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" },
    ]);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      // maxNewPerDay: 0 and maxNewReversePerDay: 0 cap name and reverse so
      // buildSession's cry card is the only one served via the new-card queue.
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderWithIntl(<ReviewSession />);

    // Cry branch shows a Reveal button alongside the play button.
    await screen.findByRole("button", { name: /reveal/i });

    expect(
      screen.getByRole("status", { name: /queue counts/i }),
    ).toBeInTheDocument();
  });

  it("instant-swap (#1191): card advances before saveSession resolves (setCards fires before persistence)", async () => {
    // Grade a card; verify the visible swap happens even while saveSession is
    // still pending. This is the core behavioural contract of the ordering
    // invert introduced in PR 2 of #1191.
    const user = userEvent.setup();
    mockLoadSettings.mockReturnValue(flipSettings);
    renderWithIntl(<ReviewSession />);

    // Wait for the first card to appear and reveal it.
    const reveal = await screen.findByRole("button", { name: /reveal/i });
    await user.click(reveal);

    // Grade buttons are now visible.
    await screen.findByRole("group", { name: /grade your answer/i });

    // Stall saveSession indefinitely so we can assert the card has already
    // swapped before the persistence promise resolves.
    let resolveSaveSession!: () => void;
    vi.mocked(saveSession).mockImplementation(
      () =>
        new Promise<import("@/lib/review/persistence").SaveResult>((resolve) => {
          resolveSaveSession = () => resolve({ ok: true });
        }),
    );

    await user.click(screen.getByRole("button", { name: /again/i }));

    // The visible swap should have happened: the card is no longer in the
    // revealed state (Reveal button is gone or grade buttons are gone).
    // React batches the state updates so we wait one tick.
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: /grade your answer/i })).not.toBeInTheDocument(),
    );

    // saveSession hasn't resolved yet - the swap was independent.
    expect(resolveSaveSession).toBeDefined();
    // Unblock the persistence chain so the test can clean up cleanly.
    resolveSaveSession();
    // Restore saveSession to its default so the stalled mockImplementation does
    // not leak into the next test (vi.clearAllMocks preserves implementations).
    vi.mocked(saveSession).mockResolvedValue({ ok: true });
  });

  it("hasMastered flag is written on mastery transition and not on non-mastery grades (#1191 Class A item 3)", async () => {
    // The describe-level beforeEach installs a fresh in-memory localStorage
    // stub before this test runs, so window.localStorage is usable here.
    //
    // Grade a card with nextReview mocked to return a state that satisfies
    // isMastered (reps=3 >= masteryRepetitions=3, scheduledDays=21 >= 21).
    //
    // Species-level mastery (#1448): BOTH name card AND paired reverse card must
    // be mastered. Pre-seed loadSession with an already-mastered reverse card for
    // species 1 so that when the name card crosses the gate the species transitions.
    const user = userEvent.setup();
    mockLoadSettings.mockReturnValue({ ...flipSettings, masteryRepetitions: 3 });
    // loadSession returns a session with the unmastered name card and an already-
    // mastered reverse card (reps=3, scheduledDays=25). maxNewReversePerDay=0 in
    // flipSettings keeps the reverse card out of the queue, but it is present in
    // newCards so speciesBecameMastered can detect the species crossing.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [FIXTURE_CARD, GRADUATED_REVERSE_CARD],
      limits: DEFAULT_LIMITS,
    });

    renderWithIntl(<ReviewSession />);

    // Flag should not be set before the grade.
    expect(window.localStorage.getItem("poke-memory:has-mastered:v2")).toBeNull();

    // Reveal and grade Easy - nextReview is mocked to return a mastered state,
    // transitioning the card from unmastered to mastered.
    const reveal = await screen.findByRole("button", { name: /reveal/i });
    await user.click(reveal);
    await screen.findByRole("group", { name: /grade your answer/i });

    // `previewIntervals` calls nextReview 4 times per render to compute
    // grade-button labels, so the mockReturnValueOnce queue is already consumed
    // by the time we reach this point. Switch to mockImplementation for the
    // entire remaining duration of this test so handleGrade gets the mastered
    // state regardless of call count.
    vi.mocked(nextReview).mockImplementation(() => ({
      stability: 10,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 21,
      reps: 3,
      lapses: 0,
      fsrsState: "review" as const,
      dueDate: "2026-06-14",
      lastReview: "2026-05-24",
      firstSeen: "2026-05-01",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    }));

    await user.click(screen.getByRole("button", { name: /easy/i }));

    // Wait for the visible swap (grade buttons disappear).
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: /grade your answer/i })).not.toBeInTheDocument(),
    );

    // writeHasMasteredFlag must have written "true" on the mastery transition.
    expect(window.localStorage.getItem("poke-memory:has-mastered:v2")).toBe("true");

    // Restore the real nextReview implementation so the mockImplementation set
    // above does not leak into subsequent tests. vi.clearAllMocks preserves
    // implementations, so an explicit restore is required here.
    if (realNextReview.current) {
      vi.mocked(nextReview).mockImplementation(realNextReview.current);
    }
  });

  it("hasMastered flag is NOT written when a non-name card (reverse) transitions into mastery (#1219)", async () => {
    // Guard: mastering a reverse card alone must not flip the flag because
    // species-level mastery (#1448/#1234) requires BOTH the name AND reverse legs
    // to be mastered - the name leg is unreviewed (reps=0) in this session.
    //
    // Use the 4-card seed with reverse-only settings so the session renders a
    // SpritePicker. nextReview is mocked to return a mastered state so that
    // tapping the correct tile triggers the wasMastered→nowMastered transition.
    const user = userEvent.setup();
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 100,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
      evolutionCardsEnabled: false,
      cryCardsEnabled: false,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    // Flag must be absent before any grade.
    expect(window.localStorage.getItem("poke-memory:has-mastered:v2")).toBeNull();

    renderWithIntl(<ReviewSession />);

    // Wait for the SpritePicker tiles to appear.
    await waitFor(() =>
      expect(screen.getAllByRole("button").some((b) => b.getAttribute("aria-label"))).toBe(true),
    );

    // Mock nextReview to return a mastered state so the transition fires.
    vi.mocked(nextReview).mockImplementation(() => ({
      stability: 10,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 21,
      reps: 3,
      lapses: 0,
      fsrsState: "review" as const,
      dueDate: "2026-06-14",
      lastReview: "2026-05-24",
      firstSeen: "2026-05-01",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    }));

    // Tap any tile (correct or incorrect - handleGrade fires either way, and
    // nextReview is fully mocked so the resulting state is mastered regardless).
    const tiles = screen
      .getAllByRole("button")
      .filter((b) => ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"].includes(b.getAttribute("aria-label") ?? ""));
    expect(tiles.length).toBeGreaterThan(0);
    await user.click(tiles[0]);

    // Wait for the grade to be processed (tiles swap or feedback appears).
    await waitFor(() => expect(saveSession).toHaveBeenCalled());

    // The flag must remain absent - the name leg is unmastered so no species
    // reached species-level mastery despite the reverse leg crossing the gate.
    expect(window.localStorage.getItem("poke-memory:has-mastered:v2")).toBeNull();

    // Restore so the mocked implementation does not leak into subsequent tests.
    if (realNextReview.current) {
      vi.mocked(nextReview).mockImplementation(realNextReview.current);
    }
  });

  it("countdown branch: QueueCounterRow is present while waiting for a learning card", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const T = Date.now();

    // Relearning card due in 30 min - beyond the 20-min learn-ahead window so
    // the countdown branch renders instead of the card.
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
        dueDate: "2026-05-20",
        lastReview: "2026-05-20",
        firstSeen: "2026-05-01",
        learningStep: 0,
        // stepMs for relearning step 0 = 600_000 ms (10 min).
        // stepStartedAt = T + 20*60_000 so dueAt = T + 30*60_000.
        stepStartedAt: T + 20 * 60_000,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [learningCard],
      limits: DEFAULT_LIMITS,
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() =>
      expect(screen.getByText(/next card in/i)).toBeInTheDocument(),
    );
    // Countdown branch delegates bottom chrome to ReviewCardLayout.
    expect(
      screen.getByRole("status", { name: /queue counts/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Regression: orphan grade-log entry on saveSession failure (#1196)
// ---------------------------------------------------------------------------

describe("persistenceChainRef: split-write guard (#1196)", () => {
  /** Minimal name-card-only settings - maxNewReversePerDay: 0 suppresses reverse cards. */
  const nameOnlySettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 0,
    cryCardsEnabled: false,
    maxNewCryPerDay: 0,
    maxReviewsCryPerDay: 0,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  it("does not call appendGradeEntry when saveSession fails (quota)", async () => {
    // saveSession returns { ok: false } - IDB or localStorage full.
    vi.mocked(saveSession).mockResolvedValue({ ok: false, reason: "quota" });
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    // Clear the mount-time saveSession call counter so we can reliably detect
    // the grade-triggered call below.
    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    vi.mocked(saveSession).mockClear();

    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    // Wait for saveSession to be called by the grade handler - this signals the
    // persistence chain settled. Then assert appendGradeEntry was NOT called.
    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalled();
    });
    // appendGradeEntry must NOT have been called - the session blob did not
    // persist, so writing the grade log would create an orphan entry (#1196).
    expect(vi.mocked(appendGradeEntry)).not.toHaveBeenCalled();
  });

  it("does not call appendGradeEntry when saveSession fails (unknown)", async () => {
    vi.mocked(saveSession).mockResolvedValue({ ok: false, reason: "unknown" });
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    vi.mocked(saveSession).mockClear();

    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    await waitFor(() => {
      expect(vi.mocked(saveSession)).toHaveBeenCalled();
    });
    expect(vi.mocked(appendGradeEntry)).not.toHaveBeenCalled();
  });

  it("surfaces the storage-error banner when saveSession fails (#1196)", async () => {
    // Use a 4-card session (FIXTURE_CARDS_4) so the session stays in the active
    // review UI after one grade - the banner only renders in the active-review
    // branches, not the session-complete screen that appears when the last card
    // is graduated with Easy.
    //
    // Mount-time saveSession call count (must succeed so quotaExceeded stays
    // false before the grade click):
    //   1. ReviewSession.tsx:840 - fresh-session initial save (loadSession → null).
    //   The post-reconciliation save (previously line 899) is now skipped when
    //   reconcileHiddenState makes no changes (#1262). Fresh sessions built by
    //   buildSession have firstSeen: null on all cards, so reconcile is always a
    //   no-op and only the initial save fires.
    // Line 858 does NOT fire because FIXTURE_CARDS_4 cards have learningStep: null
    // (buildSession initialises new cards with learningStep: null, so stampedAny
    // stays false).
    vi.mocked(saveSession)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false, reason: "quota" });
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    // Wait for mount to settle - both Once calls consumed, quotaExceeded still false.
    const revealBtn = await screen.findByRole("button", { name: /reveal/i });

    // The StorageQuotaBanner must NOT be present before the grade click - 
    // rules out mount-time contamination and proves the Once chain is sized
    // correctly. Scoped to the banner's accessible text rather than a bare
    // queryByRole("alert"), because GradeErrorBanner also carries role="alert"
    // and would mask a regression that surfaced that banner instead.
    expect(
      screen.queryByText(/progress saving is disabled/i),
    ).not.toBeInTheDocument();

    // Trigger the grade-path failure.
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    // The StorageQuotaBanner has role="alert" and contains the text below.
    // This assertion would fail if notifySaveResult(saveResult) were removed from
    // the grade-path persistence chain - because quotaExceeded would never flip
    // after the grade and the pre-grade assertion already ruled out mount-time
    // contamination.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/progress saving is disabled/i),
    ).toBeInTheDocument();
  });

  it("calls appendGradeEntry on the happy path when saveSession succeeds", async () => {
    // Regression guard: the guard must not suppress the grade-log write on success.
    vi.mocked(saveSession).mockResolvedValue({ ok: true });
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /easy/i }));

    // appendGradeEntry is called inside the persistence chain, which resolves
    // after saveSession. Polling until it is called confirms the chain settled.
    await waitFor(() => {
      expect(vi.mocked(appendGradeEntry)).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Undo snap consistent with persistence state (#1209)
// ---------------------------------------------------------------------------

describe("undo snap: only armed after successful saveSession (#1209)", () => {
  /** Minimal name-card-only settings - maxNewReversePerDay: 0 suppresses reverse cards. */
  const nameOnlySettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 0,
    cryCardsEnabled: false,
    maxNewCryPerDay: 0,
    maxReviewsCryPerDay: 0,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  // Install an in-memory localStorage stub so saveDailySummary etc. do not throw.
  function makeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k) => store.get(k) ?? null,
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => { store.delete(k); },
      setItem: (k, v) => { store.set(k, String(v)); },
    };
  }

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  it("undo button is NOT shown when saveSession fails on grade (#1209)", async () => {
    // Mount-time saves succeed; the grade-path save fails.
    // One Once call covers the single mount-time save (fresh session: all cards have
    // firstSeen=null → reconcileHiddenState is a no-op → changed=false → only the
    // hydrateSession build-from-scratch write fires). After it is consumed, every
    // subsequent call returns failure so the grade-path persistence chain exits early
    // without arming the undo snapshot.
    vi.mocked(saveSession)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false, reason: "quota" });
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    // Wait for mount to settle - the Once call is consumed.
    const revealBtn = await screen.findByRole("button", { name: /reveal/i });

    // Undo button must NOT be present before any grade (sanity baseline).
    expect(
      screen.queryByRole("button", { name: /undo last grade/i }),
    ).not.toBeInTheDocument();

    // Trigger a grade against the failing saveSession.
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /again/i }));

    // Wait for the grade-path saveSession call to resolve (persistence chain settled).
    await waitFor(() => {
      // saveSession will have been called at least twice total by now
      // (one mount-time + one grade-path).
      expect(vi.mocked(saveSession).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // The undo button must NOT be active - the snapshot was never armed because
    // saveSession returned { ok: false } (#1209).
    expect(
      screen.queryByRole("button", { name: /undo last grade/i }),
    ).not.toBeInTheDocument();
  });

  it("undo button IS shown when saveSession succeeds on grade (happy path, #1209 regression guard)", async () => {
    // All saves succeed - undo snap should be armed and the button rendered.
    vi.mocked(saveSession).mockResolvedValue({ ok: true });
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue(nameOnlySettings);

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /reveal/i });

    // Grade Again so the card re-enters the queue and the session stays active.
    await user.click(revealBtn);
    await user.click(screen.getByRole("button", { name: /again/i }));

    // After a successful save, the undo snap is armed and the button should appear.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /undo last grade/i }),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Multiple-choice name card dispatch (#1237)
// ---------------------------------------------------------------------------

describe("ReviewSession MC name card dispatch (#1237)", () => {
  /** Settings with verifiedTypedEntryMode on and all card types except name suppressed. */
  const typedModeSettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 0,
    cryCardsEnabled: false,
    maxNewCryPerDay: 0,
    maxReviewsCryPerDay: 0,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    verifiedTypedEntryMode: true,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  /** State for a brand-new card (never graded). */
  const brandNewState = {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new" as const,
    dueDate: "2026-05-27",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };

  /** State for a card mid-learning-step (after first Again grade). */
  const learningStepState = {
    ...brandNewState,
    learningStep: 0,
    stepStartedAt: Date.now() - 1000, // overdue by 1s - eligible immediately
  };

  /** State for a graduated card (lastReview set, no learningStep).
   * Must use valid FSRS field values (stability ≥ 1e-3, difficulty ∈ [1, 10])
   * so the heal guard in hydrateSession does not re-init the card to "new". */
  const graduatedState = {
    ...brandNewState,
    stability: 2.5,   // valid - above 1e-3
    difficulty: 5,    // valid - within [1, 10]
    lastReview: "2026-05-26",
    firstSeen: "2026-05-26",
    scheduledDays: 1,
    dueDate: "2026-05-27",
    reps: 3,
    fsrsState: "review" as const,
  };

  const FOUR_POKEMON = FIXTURE_CARDS_4;

  it("renders MC card (4 option buttons) for a brand-new name card in typed mode", async () => {
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    mockLoadSettings.mockReturnValue(typedModeSettings);

    renderWithIntl(<ReviewSession />);

    // MC card should render with option buttons (no Reveal button, no text input).
    await waitFor(() => {
      // At least 4 option buttons visible (2×2 grid).
      const buttons = screen.getAllByRole("button").filter(
        (b) => !/(undo|scope|clear)/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
      );
      expect(buttons.length).toBeGreaterThanOrEqual(4);
    });
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders MC card for a name card in an active learning step in typed mode", async () => {
    // Provide a card already in a learning step - overdue so it surfaces
    // immediately via the learning queue.
    const learningCard = { ...FIXTURE_CARD, state: learningStepState };
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [
        { ...learningCard },
        { ...GRADUATED_REVERSE_CARD },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });
    mockLoadSettings.mockReturnValue(typedModeSettings);

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      const buttons = screen.getAllByRole("button").filter(
        (b) => !/(undo|scope|clear)/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
      );
      expect(buttons.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("renders typed-entry card for a graduated name card in typed mode", async () => {
    // Graduated card is due today.
    const graduatedCard = { ...FIXTURE_CARD, state: graduatedState };
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [
        { ...graduatedCard },
        { ...GRADUATED_REVERSE_CARD },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
        reverse: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
      },
    });
    mockLoadSettings.mockReturnValue(typedModeSettings);

    renderWithIntl(<ReviewSession />);

    // TypedEntryNameCard renders a text input, not multiple-choice buttons.
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });

  it("renders honour-system card (Reveal button) for a brand-new name card when typed mode is off", async () => {
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    mockLoadSettings.mockReturnValue({
      ...typedModeSettings,
      verifiedTypedEntryMode: false,
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the one-time MC-card banner above the first MC card when mcCardOnboardingShown is false (#1271)", async () => {
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    mockLoadSettings.mockReturnValue({
      ...typedModeSettings,
      mcCardOnboardingShown: false,
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/this card is in the learning phase/i),
      ).toBeInTheDocument();
    });
  });

  it("does not show the MC-card banner when mcCardOnboardingShown is true (#1271)", async () => {
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    mockLoadSettings.mockReturnValue({
      ...typedModeSettings,
      mcCardOnboardingShown: true,
    });

    renderWithIntl(<ReviewSession />);

    // Wait for the MC card to render (option buttons appear).
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /choose the pokémon name/i })).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/this card is in the learning phase/i),
    ).not.toBeInTheDocument();
  });

  it("banner disappears after first MC grade and persists mcCardOnboardingShown (#1271)", async () => {
    // Arrange: session with no persisted state so Bulbasaur is brand-new and
    // surfaces as an MC learning card.
    mockSeedPokemon.mockReturnValue(FOUR_POKEMON);
    mockLoadSettings.mockReturnValue({
      ...typedModeSettings,
      mcCardOnboardingShown: false,
    });

    renderWithIntl(<ReviewSession />);

    // Act step 1: wait for MC card and assert banner is visible.
    await waitFor(() => {
      expect(
        screen.getByText(/this card is in the learning phase/i),
      ).toBeInTheDocument();
      // The MC option group should also be present.
      expect(
        screen.getByRole("group", { name: /choose the pokémon name/i }),
      ).toBeInTheDocument();
    });

    // Act step 2: click the correct option (Bulbasaur - the card's displayName).
    // The button label is the pokemon displayName; Bulbasaur is always in FOUR_POKEMON.
    const correctButton = screen.getByRole("button", { name: /^Bulbasaur$/i });

    vi.useFakeTimers();
    act(() => { fireEvent.click(correctButton); });

    // Advance past FEEDBACK_HOLD_MS so onGrade fires and state updates flush.
    await act(async () => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS + 100); });
    vi.useRealTimers();

    // Assert: banner is gone.
    expect(
      screen.queryByText(/this card is in the learning phase/i),
    ).not.toBeInTheDocument();

    // Assert: saveSettings was called with mcCardOnboardingShown: true.
    expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(
      expect.objectContaining({ mcCardOnboardingShown: true }),
    );
  });
});

// Locale smoke tests - Japanese (mandatory locale coverage per AGENTS.md)
// ---------------------------------------------------------------------------

describe("ReviewSession locale smoke - Japanese", () => {
  it("renders the loading skeleton aria-label in Japanese", () => {
    renderJa(<ReviewSession />);
    // cards starts as null - the loading skeleton is present synchronously
    // before loadSession resolves.
    expect(
      screen.getByLabelText("レビューセッションを読み込み中"),
    ).toBeInTheDocument();
  });

  it("renders the Reveal button in Japanese", async () => {
    renderJa(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /めくる/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders grade buttons in Japanese after reveal", async () => {
    const user = userEvent.setup();
    renderJa(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /めくる/i });
    await user.click(revealBtn);

    expect(screen.getByRole("button", { name: /もう一度/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /簡単/i })).toBeInTheDocument();
  });

  it("renders the all-caught-up screen in Japanese", async () => {
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [FIXTURE_CARD, GRADUATED_REVERSE_CARD],
      limits: DEFAULT_LIMITS,
    });
    const user = userEvent.setup();
    renderJa(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /めくる/i });
    await user.click(revealBtn);

    const easyBtn = screen.getByRole("button", { name: /簡単/i });
    await user.click(easyBtn);

    await waitFor(() =>
      expect(screen.getByText("すべて完了！")).toBeInTheDocument(),
    );
  });

  it("renders the grade error message in Japanese", async () => {
    const user = userEvent.setup();
    renderJa(<ReviewSession />);

    const revealBtn = await screen.findByRole("button", { name: /めくる/i });
    await user.click(revealBtn);

    vi.mocked(nextReview).mockImplementationOnce(() => {
      throw new RangeError("nextReview: invalid grade");
    });
    await user.click(screen.getByRole("button", { name: /簡単/i }));

    await waitFor(() =>
      expect(screen.getByText(/予期しないエラーにより採点を保存できませんでした/i)).toBeInTheDocument(),
    );
  });

  it("renders the review-wall heading in Japanese (1日のレビュー上限に達しました)", async () => {
    // Put a due cry card in the session with a maxReviewsCryPerDay of 0 - this
    // triggers REVIEW_SOFT_WALL, showing the reviewWall / doneForToday screen.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));

    const seedWithCry: NameReviewCard = {
      ...FIXTURE_CARD,
      cryUrl: "https://example.com/bulbasaur.ogg",
    };
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
    mockLoadSettings.mockReturnValue({
      masteryRepetitions: 3,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewEvolutionPerDay: 0,
      maxReviewsEvolutionPerDay: 0,
      maxNewReversePerDay: 0,
      maxReviewsReversePerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 0,
      maxReviewsCryPerDay: 0,
      evolutionCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      playCryOnReveal: false,
      practiceScope: { gens: [], types: [], presets: [] },
      earnedBadges: [],
    });

    renderJa(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText("1日のレビュー上限に達しました"),
      ).toBeInTheDocument();
    });
    // The "Done for today" button text should also be in Japanese.
    expect(screen.getByText("今日はここまで")).toBeInTheDocument();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Per-locale session isolation (#1562)
// ---------------------------------------------------------------------------

describe("ReviewSession per-locale session (#1562)", () => {
  /** Minimal settings for a name-only session. */
  const nameOnlySettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  /** A name card stamped with locale="ja". */
  const jaNameCard: NameReviewCard = {
    ...FIXTURE_CARD,
    locale: "ja" as const,
    state: {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new" as const,
      dueDate: "2026-05-09",
      lastReview: null,
      firstSeen: null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };

  it("builds a ja-only queue when activePokemonNameLocale is 'ja'", async () => {
    // Saved session contains only a ja name card.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [jaNameCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
    });

    renderWithIntl(<ReviewSession />);

    // The session should show the Reveal button (a ja card is due).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
  });

  it("shows no Reveal button when activePokemonNameLocale is 'en' but only ja cards exist", async () => {
    // Saved session contains only a ja name card - no en cards.
    // With activeLocale="en" the locale filter excludes the ja card from
    // the queue, so no card is shown to the user.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [jaNameCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "en",
      // Zero new-card budget so a fresh en card added by hydrateSession
      // cannot be introduced (the new-cards-locked or all-caught-up end
      // state fires instead of the card front).
      maxNewPerDay: 0,
      maxNewReversePerDay: 0,
    });

    renderWithIntl(<ReviewSession />);

    // No Reveal button - no en card is due.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
    });
  });

  it("defaults to 'en' queue when activePokemonNameLocale is absent (backward compat)", async () => {
    // No activePokemonNameLocale field in settings - component must default to "en".
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
    });

    renderWithIntl(<ReviewSession />);

    // Standard en session: Reveal button should appear for the en fixture card.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
  });

  it("suppresses typed entry when activeLocale is not 'en' (#1561)", async () => {
    // Session with a graduated ja name card - typed-entry would fire for en
    // but must be suppressed for ja since typed answers are English-only.
    const graduatedJaCard: NameReviewCard = {
      ...jaNameCard,
      state: {
        ...jaNameCard.state,
        stability: 10,
        difficulty: 5,
        elapsedDays: 25,
        scheduledDays: 25,
        reps: 3,
        lapses: 0,
        fsrsState: "review" as const,
        dueDate: "2026-05-09",
        lastReview: "2026-04-01",
        firstSeen: "2026-03-01",
      },
    };
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [graduatedJaCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
      verifiedTypedEntryMode: true,
    });

    renderWithIntl(<ReviewSession />);

    // Must NOT render a text input - typed entry is English-only (#1561).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 multi-locale tests (#1562)
// ---------------------------------------------------------------------------

describe("ReviewSession Phase 2 - multi-locale crown-jewel invariant (#1562)", () => {
  /** Minimal name-only settings. */
  const nameOnlySettings = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [] as number[], types: [] as string[], presets: [] as ("starters" | "legendaries")[] },
    earnedBadges: [] as { id: string; earnedAt: string }[],
  };

  /** en name card (new). */
  const enCard: NameReviewCard = {
    ...FIXTURE_CARD,
    id: 1,
    locale: "en" as const,
    state: {
      stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0,
      fsrsState: "new" as const, dueDate: "1970-01-01", lastReview: null, firstSeen: null,
      learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: false,
    },
  };

  /** ja name card (same species, locale="ja"). */
  const jaCard: NameReviewCard = {
    ...FIXTURE_CARD,
    id: 1,
    locale: "ja" as const,
    state: {
      stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0,
      fsrsState: "new" as const, dueDate: "1970-01-01", lastReview: null, firstSeen: null,
      learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: false,
    },
  };

  it("collision regression: active locale=ja → rendered card is a ja card, never en", async () => {
    // Seed a session with both en and ja cards for the same species.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [enCard, jaCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
    });

    renderWithIntl(<ReviewSession />);

    // Session loads. A Reveal button must appear (ja card is due).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });
    // saveSession must have been called with a cards array that includes the ja card.
    const { saveSession } = await import("@/lib/review/persistence");
    const savedCards = vi.mocked(saveSession).mock.calls.at(-1)?.[0]?.cards ?? [];
    const savedJa = savedCards.some((c) => c.locale === "ja");
    expect(savedJa).toBe(true);
  });

  it("save invariant: saveSession always receives the full multi-locale array", async () => {
    // Seed with both en and ja cards.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [enCard, jaCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
    });

    const user = userEvent.setup();
    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });

    const revealBtn = screen.getByRole("button", { name: /reveal/i });
    await user.click(revealBtn);
    const easyBtn = screen.getByRole("button", { name: /easy/i });
    await user.click(easyBtn);

    // After grading the ja card, saveSession must have received BOTH en and ja cards
    // (the full multi-locale array), not just the active-locale filtered view.
    const { saveSession } = await import("@/lib/review/persistence");
    // Look at the most recent call that has an actual cards array.
    const allCalls = vi.mocked(saveSession).mock.calls;
    const lastCallCards = allCalls.at(-1)?.[0]?.cards ?? [];
    const hasEn = lastCallCards.some((c) => (c.locale ?? "en") === "en");
    const hasJa = lastCallCards.some((c) => c.locale === "ja");
    expect(hasEn).toBe(true);
    expect(hasJa).toBe(true);
  });

  it("typed-entry note shows only when activeLocale is not en", async () => {
    // A graduated ja card so typed-entry mode would otherwise trigger.
    const graduatedJaCard: NameReviewCard = {
      ...jaCard,
      locale: "ja" as const,
      state: {
        ...jaCard.state,
        fsrsState: "review" as const,
        stability: 10,
        difficulty: 5,
        elapsedDays: 25,
        scheduledDays: 25,
        reps: 3,
        dueDate: "2026-01-01",
        lastReview: "2025-12-01",
        firstSeen: "2025-12-01",
      },
    };
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [graduatedJaCard],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
      verifiedTypedEntryMode: true,
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
    });

    // The typed-entry note must be present (#1562).
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/typed entry is only available/i);
  });

  it("typed-entry note is absent when activeLocale is en", async () => {
    // A graduated en name card - typed-entry active for en sessions.
    // With verifiedTypedEntryMode=true and activeLocale="en", the
    // typedEntryEnglishOnly note must NOT appear (#1562).
    const graduatedEnCard: NameReviewCard = {
      ...enCard,
      state: {
        ...enCard.state,
        fsrsState: "review" as const,
        stability: 10,
        difficulty: 5,
        elapsedDays: 25,
        scheduledDays: 25,
        reps: 3,
        dueDate: "2026-01-01",
        lastReview: "2025-12-01",
        firstSeen: "2025-12-01",
      },
    };
    const graduatedEnReverse = { ...GRADUATED_REVERSE_CARD, locale: "en" as const };
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [graduatedEnCard, graduatedEnReverse],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "en",
      verifiedTypedEntryMode: true,
      maxNewReversePerDay: 100,
      maxReviewsReversePerDay: 100,
    });

    renderWithIntl(<ReviewSession />);

    // Wait for the session to load (TypedEntryNameCard or GradeButtons will appear).
    await waitFor(() => {
      // Loading skeleton gone = session hydrated.
      expect(screen.queryByLabelText(/loading review session/i)).not.toBeInTheDocument();
    });

    // The typedEntryEnglishOnly note must NOT be present for English sessions.
    expect(screen.queryByText(/typed entry is only available for english/i)).not.toBeInTheDocument();
  });

  it("all-caught-up screen shows language endonym when >1 locale enrolled", async () => {
    // Provide graduated ja name + reverse (both reviewed today, not due again).
    // en name + reverse cards also provided so hydrateSession does not add new ones.
    // Active locale = "ja" → filtered view shows only ja cards → SESSION_COMPLETE.
    const today = new Date().toISOString().slice(0, 10);
    const masteredState = {
      fsrsState: "review" as const,
      stability: 10, difficulty: 5, elapsedDays: 25, scheduledDays: 25, reps: 3,
      dueDate: "2099-01-01", lastReview: today, firstSeen: "2025-01-01",
      lapses: 0, learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: false,
    };
    // ja name card (id=1, locale=ja)
    const jaName: NameReviewCard = { ...jaCard, state: masteredState };
    // ja reverse card (id=2_000_001, locale=ja) - needs a reverse shape.
    // Typed as NameReviewCard for fixture simplicity; hydrateSession will
    // recognise the saved key `2000001::ja` and skip adding a new one.
    const jaReverse = { ...jaCard, id: 2_000_001, locale: "ja" as const, cardType: "reverse" as const, pokemonId: 1, subjectKey: "1", state: masteredState };
    // en name card (id=1, locale=en)
    const enName: NameReviewCard = { ...enCard, state: masteredState };
    // en reverse card (id=2_000_001, locale=en)
    const enReverse = { ...enCard, id: 2_000_001, locale: "en" as const, cardType: "reverse" as const, pokemonId: 1, subjectKey: "1", state: masteredState };

    vi.mocked(loadSession).mockResolvedValueOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cards: [jaName, jaReverse as any, enName, enReverse as any],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "ja",
      learningLocales: ["en", "ja"],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      // The heading must name the language (#1562).
      expect(screen.getByText(/all caught up in 日本語/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("all-caught-up screen uses plain 'All caught up!' for single-locale users", async () => {
    // Provide graduated en name + reverse (reviewed today, not due).
    // Active locale = "en" → SESSION_COMPLETE, single locale → plain heading.
    const today = new Date().toISOString().slice(0, 10);
    const masteredState = {
      fsrsState: "review" as const,
      stability: 10, difficulty: 5, elapsedDays: 25, scheduledDays: 25, reps: 3,
      dueDate: "2099-01-01", lastReview: today, firstSeen: "2025-01-01",
      lapses: 0, learningStep: null, stepStartedAt: null, hiddenSince: null, seenInPasture: false,
    };
    const enName: NameReviewCard = { ...enCard, state: masteredState };
    const enReverse = { ...enCard, id: 2_000_001, locale: "en" as const, cardType: "reverse" as const, pokemonId: 1, subjectKey: "1", state: masteredState };

    vi.mocked(loadSession).mockResolvedValueOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cards: [enName, enReverse as any],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue({
      ...nameOnlySettings,
      activePokemonNameLocale: "en",
      learningLocales: ["en"],
    });

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(screen.getByText(/all caught up!/i)).toBeInTheDocument();
    }, { timeout: 3000 });
    // Must NOT include a language endonym for single-locale users.
    expect(screen.queryByText(/all caught up in/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Offline-download discovery nudge (#1538)
// ---------------------------------------------------------------------------

describe("ReviewSession offline-download nudge (#1538)", () => {
  /** Minimal settings for a name-only session that triggers the nudge. */
  const nudgeSettings: Partial<import("@/lib/settings/persistence").UserSettings> = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
    // Partial onboarding: ReviewSession reads individual fields with ?? defaults,
    // so only the fields relevant to the nudge gate need to be set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onboarding: {
      firstVisitOnboardingDismissed: true,
      // slowSpriteLoadCount at threshold → nudge should show.
      slowSpriteLoadCount: 3,
      practiceSessionsCount: 0,
      offlineDownloadNudgeDismissed: false,
      scopeEverOpened: false,
    } as import("@/lib/settings/persistence").UserSettings["onboarding"],
  };

  it("shows the nudge in the name/flip-card branch when slow-load threshold is met", async () => {
    mockLoadSettings.mockReturnValue(nudgeSettings);

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/practising offline\? download for speed/i),
      ).toBeInTheDocument();
    });
  });

  it("shows the nudge in the cry-card branch when slow-load threshold is met", async () => {
    // Zero out name/evo limits so the cry branch is the first card rendered.
    mockSeedPokemon.mockReturnValue([
      { ...FIXTURE_CARD, cryUrl: "https://example.com/bulbasaur.ogg" },
    ]);
    mockLoadSettings.mockReturnValue({
      ...nudgeSettings,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      cryCardsEnabled: true,
      maxNewCryPerDay: 10,
      maxReviewsCryPerDay: 100,
    });

    renderWithIntl(<ReviewSession />);

    // Cry branch renders a "Reveal" button - wait for it to confirm we are in
    // the cry branch, then check the nudge is present.
    await screen.findByRole("button", { name: /reveal/i });

    await waitFor(() => {
      expect(
        screen.getByText(/practising offline\? download for speed/i),
      ).toBeInTheDocument();
    });
  });

  it("shows the nudge in the reverse-card branch when slow-load threshold is met", async () => {
    // Use 4 Pokémon so SpritePicker can build its distractor tiles.
    mockSeedPokemon.mockReturnValue(FIXTURE_CARDS_4);
    mockLoadSettings.mockReturnValue({
      ...nudgeSettings,
      maxNewPerDay: 0,
      maxReviewsPerDay: 0,
      maxNewReversePerDay: 10,
      maxReviewsReversePerDay: 100,
    });

    vi.useFakeTimers();
    renderWithIntl(<ReviewSession />);
    await act(async () => { vi.advanceTimersByTime(0); });
    vi.useRealTimers();

    // Reverse branch shows 4 tile buttons (SpritePicker) - confirm the branch.
    await waitFor(() => expect(getTileButtons()).toHaveLength(4));

    expect(
      screen.getByText(/practising offline\? download for speed/i),
    ).toBeInTheDocument();
  });

  it("suppresses the nudge when a download is already present", async () => {
    // Simulate a prior download by setting the localStorage key.
    window.localStorage.setItem("poke-memory:offline-downloaded-at", "2026-01-01");
    mockLoadSettings.mockReturnValue(nudgeSettings);

    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    expect(
      screen.queryByText(/practising offline\? download for speed/i),
    ).not.toBeInTheDocument();

    window.localStorage.removeItem("poke-memory:offline-downloaded-at");
  });

  it("nudge CTA links to /settings#offline-download-heading so the Offline section expands", async () => {
    mockLoadSettings.mockReturnValue(nudgeSettings);

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/practising offline\? download for speed/i),
      ).toBeInTheDocument();
    });

    const cta = screen.getByRole("link", { name: /open offline download/i });
    expect(cta).toHaveAttribute("href", "/settings#offline-download-heading");
  });
});

// ---------------------------------------------------------------------------
// Higher-or-Lower signpost nudge seenPokemon gate (#1573)
// ---------------------------------------------------------------------------

describe("ReviewSession higher-or-lower nudge seenPokemon gate (#1573)", () => {
  /** Minimal settings that allow the nudge to show: firstVisit done, flag not dismissed. */
  const higherOrLowerNudgeSettings: Partial<import("@/lib/settings/persistence").UserSettings> = {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 0,
    maxReviewsEvolutionPerDay: 0,
    maxNewReversePerDay: 0,
    maxReviewsReversePerDay: 100,
    evolutionCardsEnabled: false,
    playCryOnReveal: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onboarding: {
      firstVisitOnboardingDismissed: true,
      higherOrLowerNudgeDismissed: false,
    } as import("@/lib/settings/persistence").UserSettings["onboarding"],
  };

  it("nudge is absent when seenPokemon.length === 0 (no card has firstSeen set)", async () => {
    // Default fixture: FIXTURE_CARD has firstSeen: null, so seenPokemon is empty.
    // The gate suppresses the nudge even though firstVisitDone is true.
    mockLoadSettings.mockReturnValue(higherOrLowerNudgeSettings);

    renderWithIntl(<ReviewSession />);

    await screen.findByRole("button", { name: /reveal/i });

    expect(
      screen.queryByText(/finish your session for a bonus mini-game/i),
    ).not.toBeInTheDocument();
  });

  it("nudge is visible when seenPokemon.length >= 1 and firstVisitDone is true", async () => {
    // Seed a saved session where the Bulbasaur name card has firstSeen set - this
    // makes getSeenPokemon return [Bulbasaur], satisfying the seenPokemon.length >= 1 gate.
    vi.mocked(loadSession).mockResolvedValueOnce({
      cards: [
        {
          ...FIXTURE_CARD,
          state: {
            ...FIXTURE_CARD.state,
            firstSeen: "2026-01-01",
            lastReview: "2026-01-01",
            reps: 1,
            fsrsState: "learning" as const,
          },
        },
        GRADUATED_REVERSE_CARD,
      ],
      limits: DEFAULT_LIMITS,
    });
    mockLoadSettings.mockReturnValue(higherOrLowerNudgeSettings);

    renderWithIntl(<ReviewSession />);

    await waitFor(() => {
      expect(
        screen.getByText(/finish your session for a bonus mini-game/i),
      ).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
