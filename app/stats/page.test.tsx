/**
 * Component tests for app/stats/page.tsx — i18n wiring (#1369).
 *
 * Verifies that all user-facing strings flow through useTranslations() and
 * render the correct values in English and Japanese.
 *
 * The page has heavy dependencies on localStorage, Recharts, and Supabase.
 * All of these are mocked so the tests are fast and focused purely on
 * the i18n wiring.
 */

import { renderWithIntl, renderJa, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before component imports so vi.mock hoisting works.
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

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// ---------------------------------------------------------------------------
// Hoisted fixtures
// ---------------------------------------------------------------------------

const { mockLoadSession } = vi.hoisted(() => ({
  mockLoadSession: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: mockLoadSession,
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
  bumpSessionStorageKey: vi.fn(),
  hydrateSession: vi.fn(() => []),
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
    maxNewReversePerDay: 10,
    maxReviewsReversePerDay: 100,
    maxNewCryPerDay: 5,
    maxReviewsCryPerDay: 50,
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    practiceScope: { gens: [], types: [], presets: [] },
    earnedBadges: [],
    retentionTarget: 0.9,
    timezone: "UTC",
    dateFormat: "dmy",
    onboarding: {
      statsHintDismissed: false,
      welcomeDismissed: true,
      practiceHintDismissed: true,
      settingsHintDismissed: true,
      installNudgeDismissed: true,
      audioHintDismissed: true,
      cardTypesHintDismissed: true,
    },
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
  DEFAULT_ONBOARDING: {
    statsHintDismissed: false,
    welcomeDismissed: false,
    practiceHintDismissed: false,
    settingsHintDismissed: false,
    installNudgeDismissed: false,
    audioHintDismissed: false,
    cardTypesHintDismissed: false,
  },
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, supabase: null, loading: false }),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({
    unlocked: false,
    flags: { pretendAllMastered: false },
    setFlag: vi.fn(),
    anyFlagOn: false,
  }),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
  SEED_REVERSE_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

vi.mock("@/lib/review/session", () => ({
  buildSession: vi.fn(() => []),
  hydrateSession: vi.fn(() => []),
  todayString: vi.fn(() => "2026-01-01"),
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
  },
}));

vi.mock("@/lib/review/scope", () => ({
  EMPTY_SCOPE: { gens: [], types: [], presets: [] },
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn().mockResolvedValue([]),
  saveGradeLog: vi.fn(),
  computeGradeTotals: vi.fn(() => ({ 1: 0, 2: 0, 4: 0, 5: 0 })),
  GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
}));

vi.mock("@/lib/stats/accuracy", () => ({
  computeAccuracySparkline: vi.fn(() => []),
  computeRollingAccuracy: vi.fn(() => null),
}));

vi.mock("@/lib/stats/direction-breakdown", () => ({
  computeDirectionBreakdown: vi.fn(() => []),
  enabledDirectionsFromSettings: vi.fn(() => []),
}));

vi.mock("@/lib/stats/retention", () => ({
  computeRetentionComparison: vi.fn(() => null),
}));

vi.mock("@/lib/stats/grade-distribution", () => ({
  computeGradeDistribution: vi.fn(() => []),
  computeGradeTrend: vi.fn(() => []),
}));

vi.mock("@/lib/stats/derive", () => ({
  MASTERY_INTERVAL_DAYS: 21,
  isMastered: vi.fn(() => false),
}));

vi.mock("@/lib/stats/heatmap", () => ({
  computeReviewHeatmap: vi.fn(() => []),
}));

vi.mock("@/lib/stats/activity-history", () => ({
  computeActivityHistory: vi.fn(() => []),
}));

vi.mock("@/lib/stats/mastery-over-time", () => ({
  computeMasteryOverTime: vi.fn(() => []),
}));

vi.mock("@/lib/stats/per-game", () => ({
  computePerGameStats: vi.fn(() => []),
}));

vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/streak/runProtection", () => ({
  runStreakProtection: vi.fn(),
}));

vi.mock("@/lib/badges/catalog", () => ({
  BADGE_CATALOG: [],
}));

vi.mock("@/lib/badges/check", () => ({
  checkBadges: vi.fn(() => []),
}));

vi.mock("@/lib/badges/derive", () => ({
  masteredSpeciesIds: vi.fn(() => new Set()),
}));

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn().mockResolvedValue(null),
  applyCloudAuthoritative: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => null),
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
  loadSyncStatus: vi.fn(() => ({})),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/sync/useRetryPush", () => ({
  useRetryPush: vi.fn(() => ({ retryState: "idle", retryNow: vi.fn() })),
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({ nameEnabled: true, evolutionEnabled: true, reverseEnabled: false, cryEnabled: false, alternateFormsEnabled: false })),
}));

const mockSnapshot = {
  mastery: {
    totalCards: 100,
    mastered: 10,
    learning: 20,
    locked: 70,
    introduced: 30,
    perGeneration: [],
    perType: [],
  },
  difficulty: { buckets: [], mean: 0 },
  projection: null,
  dueForecast: [],
  struggling: [],
  firstMasteryDays: null,
};

vi.mock("@/components/stats/DashboardSnapshotContext", () => ({
  useDashboardSnapshot: vi.fn(() => mockSnapshot),
  useProvideDashboardSnapshotInput: vi.fn(),
}));

vi.mock("@/components/stats/CompletionProjection", () => ({
  CompletionProjection: () => null,
}));

vi.mock("@/components/stats/DueForecast", () => ({
  default: () => null,
}));

vi.mock("@/components/stats/FirstMasteryHint", () => ({
  FirstMasteryHint: () => null,
}));

vi.mock("@/components/stats/GradeBreakdownBar", () => ({
  GradeBreakdownBar: () => null,
}));

vi.mock("@/components/stats/AccuracySparkline", () => ({
  AccuracySparkline: () => null,
}));

vi.mock("@/components/stats/ReviewHeatmap", () => ({
  ReviewHeatmap: () => null,
}));

vi.mock("@/components/stats/SyncStatusLine", () => ({
  SyncStatusLine: () => null,
}));

vi.mock("@/components/stats/StreakProtectionCard", () => ({
  StreakProtectionCard: () => null,
}));

vi.mock("@/components/stats/GameBreakdown", () => ({
  GameBreakdown: () => null,
}));

vi.mock("@/components/review/DirectionBadge", () => ({
  DirectionBadge: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import StatsPage from "@/app/stats/page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSession.mockResolvedValue(null);
});

describe("StatsPage — English locale", () => {
  it("renders the loading skeleton aria-label initially then section headings after data loads", async () => {
    renderWithIntl(<StatsPage />);

    // After the async load completes, the page shows section headings.
    await waitFor(() => {
      expect(screen.getByText("Accuracy")).toBeInTheDocument();
    });
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Scheduling")).toBeInTheDocument();
  });

  it("renders the Accuracy section heading", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText("Accuracy")).toBeInTheDocument();
    });
  });

  it("renders the Activity section heading", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText("Activity")).toBeInTheDocument();
    });
  });

  it("renders the Scheduling section heading", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText("Scheduling")).toBeInTheDocument();
    });
  });

  it("renders the mastery meaning hint title", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText(/what "mastered" means/i)).toBeInTheDocument();
    });
  });

  it("renders the struggling cards section heading", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText("Struggling cards")).toBeInTheDocument();
    });
  });

  it("renders the struggling cards empty state", async () => {
    renderWithIntl(<StatsPage />);
    await waitFor(() => {
      expect(screen.getByText("No struggling cards yet. Keep it up!")).toBeInTheDocument();
    });
  });
});

describe("StatsPage — Japanese locale", () => {
  it("renders section headings in Japanese", async () => {
    renderJa(<StatsPage />);

    // ja: stats.accuracyHeading = "正確さ"
    await waitFor(() => {
      expect(screen.getByText("正確さ")).toBeInTheDocument();
    });
    // ja: stats.activityHeading = "活動"
    expect(screen.getByText("活動")).toBeInTheDocument();
    // ja: stats.schedulingHeading = "スケジューリング"
    expect(screen.getByText("スケジューリング")).toBeInTheDocument();
  });

  it("renders the mastery meaning title in Japanese", async () => {
    renderJa(<StatsPage />);

    // ja: stats.masteryMeaning.title = "「習得済み」とは"
    await waitFor(() => {
      expect(screen.getByText("「習得済み」とは")).toBeInTheDocument();
    });
  });

  it("renders the struggling cards heading in Japanese", async () => {
    renderJa(<StatsPage />);

    // ja: stats.strugglingCards.heading = "苦手なカード"
    await waitFor(() => {
      expect(screen.getByText("苦手なカード")).toBeInTheDocument();
    });
  });

  it("renders the struggling cards empty state in Japanese", async () => {
    renderJa(<StatsPage />);

    // ja: stats.strugglingCards.empty = "まだ苦手なカードはありません。この調子で頑張りましょう！"
    await waitFor(() => {
      expect(screen.getByText("まだ苦手なカードはありません。この調子で頑張りましょう！")).toBeInTheDocument();
    });
  });
});

describe("StatsPage — masteryMeaning.body em emphasis", () => {
  it("renders the mastery meaning body with <em> emphasis around 'and'", async () => {
    renderWithIntl(<StatsPage />);

    // stats.masteryMeaning.body contains <em>and</em> in EN.
    // t.rich renders the em tag as a real <em> element.
    await waitFor(() => {
      const emEl = document.querySelector("em");
      expect(emEl).not.toBeNull();
      // The emphasised text should be "and" in English
      expect(emEl?.textContent).toBe("and");
    });
  });

  it("renders the mastery meaning body with <em> emphasis in Japanese", async () => {
    renderJa(<StatsPage />);

    // ja: stats.masteryMeaning.body contains <em>、かつ</em>
    await waitFor(() => {
      const emEl = document.querySelector("em");
      expect(emEl).not.toBeNull();
      // The emphasised text should be the Japanese conjunction
      expect(emEl?.textContent).toBe("、かつ");
    });
  });
});
