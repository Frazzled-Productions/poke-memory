/**
 * Tests for the StatsPage cloud-hydration behaviour (issue #514).
 *
 * These tests confirm that:
 *   1. When signed in, the page pulls cloud cards and renders the analytics.
 *   2. When signed out, only local data is used (no pullSession call).
 *
 * Note: the trainer card and badges have moved to the Journey page (#852).
 * Cloud-hydration correctness is still tested here via the mastery-over-time
 * chart stub and the force-pull button, which remain on Stats.
 */

import { renderWithIntl as render, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
// Hoisted fixtures so vi.mock factories can reference them.
// ---------------------------------------------------------------------------

import type { NameReviewCard } from "@/lib/review/session";
import type { CloudRow } from "@/lib/sync/cloud";

const { mockLoadSession, mockPullSession, mockSuiteUser } = vi.hoisted(() => {
  const mockLoadSession = vi.fn();
  const mockPullSession = vi.fn();
  const mockSuiteUser = { id: "user-123", user_metadata: {} };
  return { mockLoadSession, mockPullSession, mockSuiteUser };
});

// ---------------------------------------------------------------------------
// Minimal card factory — just enough fields to pass computeStats
// ---------------------------------------------------------------------------

function makeCard(id: number, reps = 0): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
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
    cardType: "name" as const,
    subjectKey: String(id),
    state: {
      stability: reps > 0 ? 30 : 0,
      difficulty: reps > 0 ? 5 : 0,
      elapsedDays: 0,
      scheduledDays: reps > 0 ? 30 : 0,
      reps,
      lapses: 0,
      fsrsState: reps > 0 ? ("review" as const) : ("new" as const),
      dueDate: "2099-01-01",
      lastReview: reps > 0 ? "2026-01-01" : null,
      firstSeen: reps > 0 ? "2025-12-01" : null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

// A cloud row that represents a mastered card (reps=10, scheduledDays=30).
function makeCloudRow(id: number): CloudRow {
  return {
    card_type: "name",
    subject_key: String(id),
    stability: 30,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 30,
    reps: 10,
    lapses: 0,
    fsrs_state: "review" as const,
    due_date: "2099-01-01",
    last_review: "2026-01-01",
    first_seen: "2025-12-01",
    hidden_since: null,
    seen_in_pasture: false,
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/review/persistence", () => ({
  loadSession: mockLoadSession,
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
  bumpSessionStorageKey: vi.fn(),
  STORAGE_KEY: "poke-memory:review-session:v1",
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettingsWithTimestamp: vi.fn().mockResolvedValue(null),
  pullRegionalPrefs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
  })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/streak/runProtection", () => ({
  runStreakProtection: vi.fn(() => null),
}));

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: mockPullSession,
  applyCloudAuthoritative: vi.fn(
    (
      _seed: unknown,
      _evoSeed: unknown,
      cloud: CloudRow[],
      _opts: unknown,
    ) => cloud.map((r) => makeCard(Number(r.subject_key), r.reps)),
  ),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [makeCard(1), makeCard(2), makeCard(3)],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
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
    streakProtection: {
      balance: 0,
      spendDates: [],
      daysSinceLastEarn: 0,
      lastEarnCheckDate: null,
    },
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/streak", () => ({
  loadStreakData: vi.fn(() => []),
  computeStreak: vi.fn(() => 0),
  effectiveStreakDates: vi.fn((dates: string[]) => dates),
  recordReview: vi.fn(),
  EARN_INTERVAL_DAYS: 30,
  MAX_BALANCE: 3,
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn().mockResolvedValue([]),
  saveGradeLog: vi.fn().mockResolvedValue(undefined),
  appendGradeEntry: vi.fn().mockResolvedValue({ occurredAt: Date.now() }),
  computeGradeTotals: vi.fn(() => ({ 1: 0, 2: 0, 4: 0, 5: 0 })),
  GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
}));

vi.mock("@/lib/badges/derive", () => ({
  masteredSpeciesIds: vi.fn(() => new Set<number>()),
}));

vi.mock("@/lib/badges/check", () => ({
  checkBadges: vi.fn(() => []),
}));

vi.mock("@/lib/badges/catalog", () => ({
  BADGE_CATALOG: [],
}));

vi.mock("@/lib/sync/useRetryPush", () => ({
  useRetryPush: vi.fn(() => ({ retryState: "idle", retryNow: vi.fn() })),
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => 0),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false }, anyFlagOn: false }),
}));

// Mock the DashboardSnapshotContext so the Stats page can resolve its snapshot
// without requiring a real DashboardSnapshotProvider in the test tree (#1139).
// useSetSnapshotInput is a no-op setter; useDashboardSnapshot returns a snapshot
// shaped to match what the page's mocked derivers would produce.
const { mockSnapshotValue } = vi.hoisted(() => ({
  mockSnapshotValue: {
    snapshot: {
      today: "2026-05-21",
      forceAllMastered: false,
      queue: { newCount: 0, learningCount: 0, reviewCount: 0, totalCount: 0 },
      dueForecast: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-05-${String(14 + i).padStart(2, "0")}`,
        count: 0,
      })),
      mastery: {
        totalCards: 3,
        introduced: 0,
        learning: 0,
        mastered: 0,
        locked: 3,
        perGeneration: [],
        perType: [],
      },
      struggling: [],
      projection: { kind: "insufficient-history" as const },
      firstMasteryDays: null,
      difficulty: { buckets: [], mean: null },
    } as import("@/lib/stats/dashboard-snapshot").DashboardSnapshot,
  },
}));

vi.mock("@/components/stats/DashboardSnapshotContext", () => ({
  useDashboardSnapshot: () => mockSnapshotValue.snapshot,
  useProvideDashboardSnapshotInput: () => undefined,
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({
    nameEnabled: true,
    evolutionEnabled: true,
    reverseEnabled: false,
    reverseEvolutionEnabled: false,
    cryEnabled: false,
  })),
}));

// Mock stat/record derivers to keep tests fast and focused on card-source logic.
vi.mock("@/lib/stats/derive", () => ({
  computeStats: vi.fn(
    (cards: NameReviewCard[]) => ({
      totalCards: cards.length,
      mastered: cards.filter((c) => c.state.reps >= 3).length,
      learning: 0,
      locked: cards.filter((c) => c.state.reps < 3).length,
      introduced: cards.filter((c) => c.state.firstSeen !== null).length,
      perGeneration: [],
      perType: [],
      struggling: [],
      dueForecast: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-05-${String(14 + i).padStart(2, "0")}`,
        count: 0,
      })),
    }),
  ),
  // `isMastered` and `MASTERY_REPETITIONS` are used by computeMasteryOverTime,
  // which is called from the stats page's reviewCharts computation.
  // `MASTERY_INTERVAL_DAYS` is read by the FirstMasteryHint render path.
  isMastered: vi.fn((state: { reps: number; scheduledDays: number }) =>
    state.reps >= 3 && state.scheduledDays >= 21,
  ),
  MASTERY_REPETITIONS: 3,
  MASTERY_INTERVAL_DAYS: 21,
  DUE_FORECAST_DAYS: 14,
}));

vi.mock("@/lib/stats/records", () => ({
  computeRecords: vi.fn(() => null),
}));

vi.mock("@/lib/stats/completion-projection", () => ({
  computeCompletionProjection: vi.fn(() => ({ kind: "insufficient-history" })),
}));

vi.mock("@/lib/srs/timeToMastery", () => ({
  projectTimeToFirstMastery: vi.fn(() => ({ days: 20 })),
}));

vi.mock("@/components/stats/CompletionProjection", () => ({
  CompletionProjection: () => <div data-testid="completion-projection" />,
}));

vi.mock("@/lib/stats/mastery-over-time", () => ({
  computeMasteryOverTime: vi.fn(() => []),
}));

vi.mock("@/lib/stats/heatmap", () => ({
  computeReviewHeatmap: vi.fn(() => []),
}));

vi.mock("@/lib/stats/accuracy", () => ({
  computeAccuracySparkline: vi.fn(() => []),
  computeRollingAccuracy: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Auth context mock — swapped per-describe
// ---------------------------------------------------------------------------

const { mockAuthValue } = vi.hoisted(() => ({
  mockAuthValue: {
    user: null as null | typeof mockSuiteUser,
    supabase: null as null | { auth: unknown },
    loading: false,
  },
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockAuthValue,
}));

// ---------------------------------------------------------------------------
// Stub heavy sub-components that would otherwise pull in lots of deps
// ---------------------------------------------------------------------------

vi.mock("@/components/stats/SyncStatusLine", () => ({
  SyncStatusLine: () => <div data-testid="sync-status-line" />,
}));

// TrainerCard has moved to the Journey page (#852) — Stats no longer renders it.
// Keep the mock defined so imports resolve cleanly if any transitional reference remains.
vi.mock("@/components/stats/TrainerCard", () => ({
  TrainerCard: ({ totalMastered }: { totalMastered: number }) => (
    <div data-testid="trainer-card">mastered:{totalMastered}</div>
  ),
}));

vi.mock("@/components/stats/GradeBreakdownBar", () => ({
  GradeBreakdownBar: () => <div data-testid="grade-breakdown-bar" />,
}));

vi.mock("@/components/stats/AccuracySparkline", () => ({
  AccuracySparkline: () => <div data-testid="accuracy-sparkline" />,
}));

vi.mock("@/components/stats/TypeBreakdown", () => ({
  TypeBreakdown: () => <div data-testid="type-breakdown" />,
}));

vi.mock("@/components/stats/RecordsCard", () => ({
  RecordsCard: () => <div data-testid="records-card" />,
}));

vi.mock("@/components/stats/ReviewHeatmap", () => ({
  ReviewHeatmap: () => <div data-testid="review-heatmap" />,
}));

vi.mock("@/components/stats/MasteryOverTimeChart", () => ({
  MasteryOverTimeChart: () => <div data-testid="mastery-over-time-chart" />,
}));

vi.mock("@/components/onboarding/OnboardingHint", () => ({
  OnboardingHint: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="onboarding-hint">{children}</div>
  ),
}));

vi.mock("@/components/stats/GameBreakdown", () => ({
  GameBreakdown: () => <div data-testid="game-breakdown" />,
}));

vi.mock("@/lib/stats/per-game", () => ({
  computePerGameStats: vi.fn(() => [
    { slug: "red-blue", total: 151, introduced: 0, mastered: 0 },
  ]),
}));

// ---------------------------------------------------------------------------
// Import the page component (after all vi.mock calls)
// ---------------------------------------------------------------------------

import StatsPage from "@/app/stats/page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty local session
  mockLoadSession.mockResolvedValue(null);
  // Default: no cloud rows
  mockPullSession.mockResolvedValue([]);
  // Default: guest
  mockAuthValue.user = null;
  mockAuthValue.supabase = null;
  // Reset the mock snapshot to the default state so hint tests don't leak.
  mockSnapshotValue.snapshot = {
    today: "2026-05-21",
    forceAllMastered: false,
    queue: { newCount: 0, learningCount: 0, reviewCount: 0, totalCount: 0 },
    dueForecast: Array.from({ length: 14 }, (_, i) => ({
      date: `2026-05-${String(14 + i).padStart(2, "0")}`,
      count: 0,
    })),
    mastery: {
      totalCards: 3,
      introduced: 0,
      learning: 0,
      mastered: 0,
      locked: 3,
      perGeneration: [],
      perType: [],
    },
    struggling: [],
    projection: { kind: "insufficient-history" as const },
    firstMasteryDays: null,
    difficulty: { buckets: [], mean: null },
  };
});

describe("StatsPage — signed-in user hydrates from cloud", () => {
  it("calls pullSession when signed in and renders the analytics once hydrated", async () => {
    // Arrange: local is empty, cloud has 3 mastered cards.
    mockLoadSession.mockResolvedValue(null);
    const cloudRows = [makeCloudRow(1), makeCloudRow(2), makeCloudRow(3)];
    mockPullSession.mockResolvedValue(cloudRows);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    // The mastery-over-time chart stub renders once the analytics are ready.
    // applyCloudAuthoritative is mocked to map cloud rows → cards with reps=10.
    await waitFor(() => {
      expect(screen.getByTestId("mastery-over-time-chart")).toBeInTheDocument();
    });

    expect(mockPullSession).toHaveBeenCalledTimes(1);
    expect(mockPullSession).toHaveBeenCalledWith(mockAuthValue.supabase, mockSuiteUser.id);
  });

  it("falls back gracefully when pullSession returns null (network failure)", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockPullSession.mockResolvedValue(null);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    // Should not throw; page should still render from local fallback.
    render(<StatsPage />);

    // The review heatmap stub is always rendered once the page has loaded data.
    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });
  });

  it("falls back gracefully when pullSession throws (unexpected error)", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockPullSession.mockRejectedValue(new Error("timeout"));
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });
  });
});

describe("StatsPage — guest user reads only from local", () => {
  it("does not call pullSession when user is null", async () => {
    // Arrange: local has 2 cards, one mastered.
    const localCard = makeCard(1, 5); // reps=5 → mastered
    const localCard2 = makeCard(2, 0); // reps=0 → not mastered
    mockLoadSession.mockResolvedValue({
      cards: [localCard, localCard2],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    // The mastery-over-time chart stub should be present in the rendered tree
    // once the local data has been loaded and processed.
    await waitFor(() => {
      expect(screen.getByTestId("mastery-over-time-chart")).toBeInTheDocument();
    });

    // pullSession must never be called for guests.
    expect(mockPullSession).not.toHaveBeenCalled();
  });
});

describe("StatsPage — Force pull from cloud button", () => {
  it("is not visible when the user is a guest", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /force pull from cloud/i })).toBeNull();
  });

  it("is visible when the user is signed in", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockPullSession.mockResolvedValue([]);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /force pull from cloud/i }),
      ).toBeInTheDocument();
    });
  });

  it("clicking the button pulls all five tables and persists each cloud-authoritative", async () => {
    // Pulls run in parallel via Promise.all; assert each was called and that
    // the destructured results were applied to the right local sink. Catches
    // a future regression where the parallel array order is transposed.
    const { pullSettingsWithTimestamp, pullRegionalPrefs } = await import(
      "@/lib/sync/settings"
    );
    const { pullStreak } = await import("@/lib/sync/streak");
    const { pullGradeLog } = await import("@/lib/sync/gradeLog");
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const { saveGradeLog } = await import("@/lib/gradelog/persistence");
    const settingsMod = await import("@/lib/settings/persistence");

    mockLoadSession.mockResolvedValue(null);
    mockPullSession.mockResolvedValue([makeCloudRow(1)]);
    vi.mocked(pullSettingsWithTimestamp).mockResolvedValueOnce({
      settings: { masteryRepetitions: 3 } as never,
      updatedAt: "2026-05-14T10:00:00.000Z",
    });
    vi.mocked(pullRegionalPrefs).mockResolvedValueOnce({
      timezone: "Europe/London",
      dateFormat: "dmy",
      pushNotificationHour: null,
    });
    vi.mocked(pullStreak).mockResolvedValueOnce(["2026-05-13", "2026-05-14"]);
    vi.mocked(pullGradeLog).mockResolvedValueOnce([
      { occurredAt: 1, date: "2026-05-14", cardType: "name", grade: 4 },
    ]);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    const button = await screen.findByRole("button", {
      name: /force pull from cloud/i,
    });
    button.click();

    await waitFor(() => {
      expect(pullSettingsWithTimestamp).toHaveBeenCalled();
      expect(pullRegionalPrefs).toHaveBeenCalled();
      expect(pullStreak).toHaveBeenCalled();
      expect(pullGradeLog).toHaveBeenCalled();
      expect(saveStreakData).toHaveBeenCalledWith(["2026-05-13", "2026-05-14"]);
      expect(saveGradeLog).toHaveBeenCalledWith([
        { occurredAt: 1, date: "2026-05-14", cardType: "name", grade: 4 },
      ]);
      expect(settingsMod.saveSettings).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });
});

describe("StatsPage — CompletionProjection widget", () => {
  it("renders the completion-projection stub in the page", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("completion-projection")).toBeInTheDocument();
    });
  });
});

describe("StatsPage — FirstMasteryHint (#1083)", () => {
  it("renders the hint when the snapshot has firstMasteryDays set", async () => {
    // The page renders the hint when snapshot.firstMasteryDays is non-null.
    // Set it on the mock snapshot and verify the hint text appears.
    mockSnapshotValue.snapshot = {
      ...mockSnapshotValue.snapshot,
      firstMasteryDays: 20,
    };
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("first-mastery-hint")).toBeInTheDocument();
    });
    expect(screen.getByTestId("first-mastery-hint").textContent).toContain(
      "20",
    );
  });

  it("hides the hint when snapshot.firstMasteryDays is null (mastered cards present)", async () => {
    // computeDashboardSnapshot returns firstMasteryDays=null when mastered > 0
    // because there is no projection to show for already-mastered cards.
    mockSnapshotValue.snapshot = {
      ...mockSnapshotValue.snapshot,
      firstMasteryDays: null,
      mastery: {
        totalCards: 3,
        introduced: 3,
        learning: 0,
        mastered: 3,  // all mastered — hint suppressed
        locked: 0,
        perGeneration: [],
        perType: [],
      },
    };
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("first-mastery-hint")).toBeNull();
  });

  it("hides the hint when snapshot.firstMasteryDays is null (no cards introduced)", async () => {
    // computeDashboardSnapshot returns firstMasteryDays=null when introduced === 0
    // because there is no learning progress to project from.
    mockSnapshotValue.snapshot = {
      ...mockSnapshotValue.snapshot,
      firstMasteryDays: null,
      mastery: {
        totalCards: 3,
        introduced: 0,  // all locked — hint suppressed
        learning: 0,
        mastered: 0,
        locked: 3,
        perGeneration: [],
        perType: [],
      },
    };
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("first-mastery-hint")).toBeNull();
  });

  it("hides the hint when snapshot.firstMasteryDays is null and forceAllMastered is on", async () => {
    // computeDashboardSnapshot returns firstMasteryDays=null when forceAllMastered
    // is active, regardless of real card state. The mock reflects that directly.
    mockSnapshotValue.snapshot = {
      ...mockSnapshotValue.snapshot,
      firstMasteryDays: null,
      forceAllMastered: true,
      mastery: {
        totalCards: 3,
        introduced: 3,
        learning: 0,
        mastered: 3,
        locked: 0,
        perGeneration: [],
        perType: [],
      },
    };
    mockAuthValue.user = null;
    mockAuthValue.supabase = null;

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("review-heatmap")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("first-mastery-hint")).toBeNull();
  });
});
