/**
 * Tests for the StatsPage cloud-hydration behaviour (issue #514).
 *
 * These tests confirm that:
 *   1. When signed in, the page swaps from local to cloud cards after the
 *      cloud pull resolves.
 *   2. When signed out, only local data is used (no pullSession call).
 */

import { render, screen, waitFor } from "@testing-library/react";
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
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/streak", () => ({
  loadStreakData: vi.fn(() => []),
  computeStreak: vi.fn(() => 0),
  recordReview: vi.fn(),
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

vi.mock("@/lib/review/useSessionStorageKey", () => ({
  useSessionStorageKey: vi.fn(() => 0),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false }, anyFlagOn: false }),
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
}));

vi.mock("@/lib/stats/records", () => ({
  computeRecords: vi.fn(() => null),
}));

vi.mock("@/lib/stats/completion-projection", () => ({
  computeCompletionProjection: vi.fn(() => ({ kind: "insufficient-history" })),
}));

vi.mock("@/components/stats/CompletionProjection", () => ({
  CompletionProjection: () => <div data-testid="completion-projection" />,
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

vi.mock("@/components/onboarding/OnboardingHint", () => ({
  OnboardingHint: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="onboarding-hint">{children}</div>
  ),
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
});

describe("StatsPage — signed-in user hydrates from cloud", () => {
  it("uses cloud cards when pullSession returns rows and local is empty", async () => {
    // Arrange: local is empty, cloud has 3 mastered cards.
    mockLoadSession.mockResolvedValue(null);
    const cloudRows = [makeCloudRow(1), makeCloudRow(2), makeCloudRow(3)];
    mockPullSession.mockResolvedValue(cloudRows);
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    // The TrainerCard should eventually show mastered count from cloud rows.
    // applyCloudAuthoritative is mocked to map cloud rows → cards with reps=10
    // (>= masteryRepetitions=3), so computeStats.mastered = 3.
    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toHaveTextContent("mastered:3");
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

    await waitFor(() => {
      // Local was empty → 0 mastered
      expect(screen.getByTestId("trainer-card")).toHaveTextContent("mastered:0");
    });
  });

  it("falls back gracefully when pullSession throws (unexpected error)", async () => {
    mockLoadSession.mockResolvedValue(null);
    mockPullSession.mockRejectedValue(new Error("timeout"));
    mockAuthValue.user = mockSuiteUser;
    mockAuthValue.supabase = { auth: {} };

    render(<StatsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toHaveTextContent("mastered:0");
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

    await waitFor(() => {
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
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
      expect(screen.getByTestId("trainer-card")).toBeInTheDocument();
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
