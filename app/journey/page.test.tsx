/**
 * Component tests for app/journey/page.tsx — i18n wiring (#1369).
 *
 * Verifies that all user-facing strings flow through useTranslations() and
 * render the correct values in English and Japanese.
 *
 * The page has heavy dependencies on localStorage, Supabase, and animated
 * child components. All of these are mocked so the tests are fast and focused
 * purely on the i18n wiring.
 */

import { renderWithIntl, renderJa, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before component imports.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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
    streakProtection: { spendDates: [] },
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
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
  hydrateSession: vi.fn(() => ({ cards: [], anyHealed: false })),
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
  GRADE_LOG_APPENDED_EVENT: "poke-memory:grade-log-appended",
}));

vi.mock("@/lib/streak", () => ({
  computeStreak: vi.fn(() => 0),
  effectiveStreakDates: vi.fn((dates: string[]) => dates),
  loadStreakData: vi.fn(() => []),
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
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({ nameEnabled: true, evolutionEnabled: true, reverseEnabled: false, cryEnabled: false, alternateFormsEnabled: false })),
}));

vi.mock("@/lib/journey/milestones", () => ({
  detectTopMilestone: vi.fn(() => null),
}));

vi.mock("@/lib/journey/closeToMastery", () => ({
  deriveCloseToMastery: vi.fn(() => []),
}));

vi.mock("@/lib/evolution/chains", () => ({
  deriveEvolutionFamilies: vi.fn(() => []),
}));

vi.mock("@/lib/timeline/reconstruct", () => ({
  buildCollectionTimeline: vi.fn(() => ({
    events: [],
    masteredCount: 0,
    totalSpecies: 0,
  })),
}));

vi.mock("@/lib/stats/records", () => ({
  computeRecords: vi.fn(() => null),
}));

vi.mock("@/lib/stats/useCountUp", () => ({
  useCountUp: vi.fn((v: number) => v),
}));

const mockMasterySnapshot = {
  totalCards: 100,
  mastered: 10,
  learning: 20,
  locked: 70,
  introduced: 30,
  perGeneration: [],
  perType: [],
};

vi.mock("@/components/stats/DashboardSnapshotContext", () => ({
  useDashboardSnapshot: vi.fn(() => ({ mastery: mockMasterySnapshot })),
  useProvideDashboardSnapshotInput: vi.fn(),
}));

vi.mock("@/components/stats/TrainerCard", () => ({
  TrainerCard: () => null,
}));

vi.mock("@/components/stats/TypeBreakdown", () => ({
  TypeBreakdown: () => null,
}));

vi.mock("@/components/stats/RecordsCard", () => ({
  RecordsCard: () => null,
}));

vi.mock("@/components/journey/CollectionTimeline", () => ({
  CollectionTimeline: () => <div data-testid="collection-timeline" />,
}));

vi.mock("@/components/journey/EvolutionWall", () => ({
  EvolutionWall: () => <div data-testid="evolution-wall" />,
}));

vi.mock("@/components/journey/MilestoneShareButton", () => ({
  MilestoneShareButton: () => null,
}));

vi.mock("@/components/journey/CloseToMastery", () => ({
  CloseToMastery: () => <div data-testid="close-to-mastery" />,
}));

vi.mock("@/components/badges/BadgeGallery", () => ({
  BadgeGallery: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import JourneyPage from "@/app/journey/page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  mockLoadSession.mockResolvedValue(null);
  // Reset computeStreak to its default (0 = no active streak) so tests don't
  // bleed streak state into each other.
  const { computeStreak } = vi.mocked(await import("@/lib/streak"));
  computeStreak.mockReturnValue(0);
});

describe("JourneyPage — English locale", () => {
  it("renders the current streak heading", async () => {
    renderWithIntl(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByText("Current streak")).toBeInTheDocument();
    });
  });

  it("renders the no-streak empty state when streak is 0", async () => {
    renderWithIntl(<JourneyPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No active streak. Review some cards to start one!"),
      ).toBeInTheDocument();
    });
  });

  it("renders the mastery distribution heading", async () => {
    renderWithIntl(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getByText("Mastery distribution")).toBeInTheDocument();
    });
  });

  it("renders the Locked ring label", async () => {
    renderWithIntl(<JourneyPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Locked").length).toBeGreaterThan(0);
    });
  });

  it("renders the by-generation column headers", async () => {
    renderWithIntl(<JourneyPage />);

    await waitFor(() => {
      // journey.byGenerationColumn = "Generation"
      expect(screen.getByText("Generation")).toBeInTheDocument();
      expect(screen.getByText("Mastered / Total")).toBeInTheDocument();
    });
  });
});

describe("JourneyPage — with active streak", () => {
  beforeEach(async () => {
    const { computeStreak } = vi.mocked(
      await import("@/lib/streak"),
    );
    computeStreak.mockReturnValue(5);
  });

  it("renders the daysInARow ICU plural for count=5", async () => {
    renderWithIntl(<JourneyPage />);

    // English: "{count, plural, one {day in a row} other {days in a row}}"
    // Count renders separately as the large animated number; label has no duplication.
    await waitFor(() => {
      expect(screen.getByText("days in a row")).toBeInTheDocument();
    });
  });
});

describe("JourneyPage — Japanese locale", () => {
  it("renders the current streak heading in Japanese", async () => {
    renderJa(<JourneyPage />);

    // ja: journey.currentStreak = "現在の連続日数"
    await waitFor(() => {
      expect(screen.getByText("現在の連続日数")).toBeInTheDocument();
    });
  });

  it("renders the no-streak message in Japanese", async () => {
    renderJa(<JourneyPage />);

    // ja: journey.noStreak = "連続記録なし。カードをレビューして始めましょう！"
    await waitFor(() => {
      expect(
        screen.getByText(/連続記録なし/),
      ).toBeInTheDocument();
    });
  });

  it("renders the mastery distribution heading in Japanese", async () => {
    renderJa(<JourneyPage />);

    // ja: journey.masteryDistribution = "習得状況の分布"
    await waitFor(() => {
      expect(screen.getByText("習得状況の分布")).toBeInTheDocument();
    });
  });

  it("renders the by-generation column headers in Japanese", async () => {
    renderJa(<JourneyPage />);

    await waitFor(() => {
      // ja: journey.byGenerationColumn = "ジェネレーション"
      expect(screen.getByText("ジェネレーション")).toBeInTheDocument();
      // ja: journey.byGenerationMasteredTotal = "習得済み / 合計"
      expect(screen.getByText("習得済み / 合計")).toBeInTheDocument();
    });
  });

  describe("with active streak", () => {
    beforeEach(async () => {
      const { computeStreak } = vi.mocked(await import("@/lib/streak"));
      computeStreak.mockReturnValue(7);
    });

    it("renders the daysInARow ICU plural in Japanese for count=7", async () => {
      renderJa(<JourneyPage />);

      // ja: journey.daysInARow = "{count, plural, other {日連続}}"
      // Count renders separately as the large animated number; label has no duplication.
      await waitFor(() => {
        expect(screen.getByText("日連続")).toBeInTheDocument();
      });
    });
  });
});
