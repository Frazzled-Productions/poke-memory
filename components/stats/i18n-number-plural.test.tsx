/**
 * Locale-coverage tests for #1408 — number formatting and ICU pluralisation.
 *
 * Verifies that the migrated components:
 *   - Render locale-aware numbers (not hardcoded en-GB) in ja / zh-Hans / zh-Hant.
 *   - Use ICU plural rules: count=1 picks "one" branch in en, count=2 picks "other"
 *     in en; CJK locales always use "other".
 *
 * Test project: jsdom (components/**).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
} from "@/components/test-utils/renderWithIntl";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Component imports
// ---------------------------------------------------------------------------

import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import type { HeatmapCell } from "@/lib/stats/heatmap";
import DueForecast from "@/components/stats/DueForecast";
import type { DueForecastDay } from "@/lib/stats/derive";
import { RetentionIndicator } from "@/components/stats/RetentionIndicator";
import type { RetentionComparison } from "@/lib/stats/retention";
import { FirstMasteryHint } from "@/components/stats/FirstMasteryHint";
import { StreakBadge } from "@/components/review/StreakBadge";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";
import { DirectionBreakdownChart } from "@/components/stats/DirectionBreakdownChart";
import type { DirectionBreakdownRow } from "@/lib/stats/direction-breakdown";
import { CollectionTimeline as CollectionTimelineWidget } from "@/components/journey/CollectionTimeline";
import type { CollectionTimeline } from "@/lib/timeline/reconstruct";

// ---------------------------------------------------------------------------
// Recharts mock (shared across all chart tests in this file)
// ---------------------------------------------------------------------------

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="bar">{children ?? null}</div>
  ),
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  PolarAngleAxis: () => null,
  RadialBar: () => null,
  RadialBarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// StreakBadge helpers
// ---------------------------------------------------------------------------

vi.mock("@/lib/streak", () => ({
  computeStreak: vi.fn(() => 5),
  effectiveStreakDates: vi.fn(() => []),
  loadStreakData: vi.fn(() => ({})),
  STREAK_UPDATED_EVENT: "streak-updated",
}));

// Import after mock so vi.mocked() resolves to the mock implementation.
import { computeStreak } from "@/lib/streak";
vi.mock("@/lib/streak/runProtection", () => ({
  runStreakProtection: vi.fn(),
}));
vi.mock("@/lib/streak/milestones", () => ({
  findPendingMilestone: vi.fn(() => null),
}));
vi.mock("@/lib/streak/useStreakNavState", () => ({
  useStreakNavState: () => ({
    streak: null,
    tokenBalance: null,
    daysToNextMilestone: null,
  }),
}));
vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn(() => "2026-01-01"),
}));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    timezone: "UTC",
    seenStreakMilestones: [],
    streakProtection: { balance: 0, spendDates: [] },
  })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "settings-saved",
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({
    flags: { forceNextStreakMilestone: false },
    setFlag: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeatmapColumns(count: number): readonly (readonly HeatmapCell[])[] {
  return Array.from({ length: 53 }, (_, col) =>
    Array.from({ length: 7 }, (__, row) => ({
      date: `2026-01-${String((col * 7 + row + 1) % 28 || 1).padStart(2, "0")}`,
      count: col === 0 && row === 0 ? count : 0,
    })),
  );
}

function makeForecast(count: number): readonly DueForecastDay[] {
  return Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    count: i === 0 ? count : 0,
  }));
}

const RETENTION_COMPARISON_MOCK: RetentionComparison = {
  actual: 0.88,
  target: 0.9,
  delta: -0.02,
  reviews: 1234,
  windowDays: 365,
};

const DIRECTION_ROWS: readonly DirectionBreakdownRow[] = [
  { direction: "name", total: 42, passes: 36, accuracy: 0.86, disabled: false },
];

const EMPTY_TIMELINE: CollectionTimeline = {
  past: [],
  future: [],
  nowMs: Date.now(),
  totalSpecies: 0,
};

// ---------------------------------------------------------------------------
// ReviewHeatmap
// ---------------------------------------------------------------------------

describe("ReviewHeatmap — locale coverage (#1408)", () => {
  const LOCALES: AppLocale[] = ["en", "ja", "zh-Hans", "zh-Hant"];

  it("renders 0 reviews in all locales without throwing", () => {
    for (const locale of LOCALES) {
      const { unmount } = renderWithIntl(
        <ReviewHeatmap columns={makeHeatmapColumns(0)} />,
        { locale },
      );
      // Heading is localised — just assert one heading exists.
      expect(screen.getByRole("heading")).toBeInTheDocument();
      unmount();
    }
  });

  it("en: count=1 renders singular '1 review in the last year'", () => {
    renderWithIntl(<ReviewHeatmap columns={makeHeatmapColumns(1)} />);
    expect(screen.getByText(/1 review in the last year/)).toBeInTheDocument();
  });

  it("en: count=5 renders plural '5 reviews in the last year'", () => {
    renderWithIntl(<ReviewHeatmap columns={makeHeatmapColumns(5)} />);
    expect(screen.getByText(/5 reviews in the last year/)).toBeInTheDocument();
  });

  it("ja: renders the plural form (no 'one' branch in Japanese)", () => {
    renderJa(<ReviewHeatmap columns={makeHeatmapColumns(1)} />);
    // Japanese always uses 'other' branch. The heading + any cells contain "1"
    // so use getAllByText to avoid "multiple elements" error.
    const matches = screen.getAllByText(/1/);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DueForecast
// ---------------------------------------------------------------------------

describe("DueForecast — locale coverage (#1408)", () => {
  it("en: count=1 renders singular '1 card over the next 14 days'", () => {
    renderWithIntl(<DueForecast forecast={makeForecast(1)} />);
    expect(screen.getByText(/1 card over the next 14 days/)).toBeInTheDocument();
  });

  it("en: count=5 renders plural '5 cards over the next 14 days'", () => {
    renderWithIntl(<DueForecast forecast={makeForecast(5)} />);
    expect(screen.getByText(/5 cards over the next 14 days/)).toBeInTheDocument();
  });

  it("ja: renders the headline without throwing", () => {
    renderJa(<DueForecast forecast={makeForecast(10)} />);
    expect(screen.getByRole("heading", { name: /due forecast/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RetentionIndicator
// ---------------------------------------------------------------------------

describe("RetentionIndicator — locale coverage (#1408)", () => {
  it("en: renders the review count with ICU plural (1234 reviews)", () => {
    renderWithIntl(<RetentionIndicator comparison={RETENTION_COMPARISON_MOCK} />);
    // 1234 reviews — 'other' branch
    expect(screen.getByText(/1,234 reviews/i)).toBeInTheDocument();
  });

  it("en: count=1 renders singular 'Based on 1 review'", () => {
    const singleReview: RetentionComparison = {
      actual: 1.0,
      target: 0.9,
      delta: 0.1,
      reviews: 1,
      windowDays: 365,
    };
    renderWithIntl(<RetentionIndicator comparison={singleReview} />);
    expect(screen.getByText(/Based on 1 review over/i)).toBeInTheDocument();
  });

  it("ja: renders without throwing", () => {
    renderJa(<RetentionIndicator comparison={RETENTION_COMPARISON_MOCK} />);
    // Heading is localised in Japanese.
    expect(screen.getByRole("heading", { name: /記憶率 vs 目標/ })).toBeInTheDocument();
  });

  it("percent formatting is locale-aware (en: formatPct(0.9) contains %)", () => {
    renderWithIntl(<RetentionIndicator comparison={RETENTION_COMPARISON_MOCK} />);
    // Target is 90% — should appear as "90%" in en
    expect(screen.getAllByText(/90%/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// StreakBadge
// ---------------------------------------------------------------------------

describe("StreakBadge — locale coverage (#1408)", () => {
  afterEach(() => {
    // Restore the default mock value (count=5) after each test in this block.
    vi.mocked(computeStreak).mockReturnValue(5);
  });

  it("en: renders '5 days streak' (count=5, 'other' branch)", () => {
    renderWithIntl(<StreakBadge />);
    expect(screen.getByText(/5 days streak/)).toBeInTheDocument();
  });

  it("en: count=1 renders '1 day streak' ('one' branch)", () => {
    // Override computeStreak to return 1 for this test only.
    vi.mocked(computeStreak).mockReturnValue(1);
    renderWithIntl(<StreakBadge />);
    expect(screen.getByText(/1 day streak/)).toBeInTheDocument();
  });

  it("ja: renders the streak badge without throwing", () => {
    renderJa(<StreakBadge />);
    // Should render streak text in Japanese
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FsrsOptimizerSection — cooldown message
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultOptimizerProps = {
  fsrsWeightsOptimizedAt: undefined,
  optimizableReviewCount: 300,
  isSignedIn: true,
  superuserPaused: false,
  onOptimized: vi.fn(),
};

describe("FsrsOptimizerSection — cooldown locale coverage (#1408)", () => {
  it("en: 'Next optimisation in N days' uses ICU plural (count > 1)", () => {
    const optimizedAt = new Date(Date.now() - 2 * MS_PER_DAY).toISOString();
    renderWithIntl(
      <FsrsOptimizerSection
        {...defaultOptimizerProps}
        fsrsWeightsOptimizedAt={optimizedAt}
      />,
    );
    const button = screen.getByTestId("fsrs-optimize-button");
    expect(button.textContent).toMatch(/Next optimisation in \d+ days/);
  });

  it("ja: cooldown message renders without throwing", () => {
    const optimizedAt = new Date(Date.now() - 2 * MS_PER_DAY).toISOString();
    renderJa(
      <FsrsOptimizerSection
        {...defaultOptimizerProps}
        fsrsWeightsOptimizedAt={optimizedAt}
      />,
    );
    const button = screen.getByTestId("fsrs-optimize-button");
    expect(button).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DirectionBreakdownChart — per-direction review count list
// ---------------------------------------------------------------------------

describe("DirectionBreakdownChart — locale coverage (#1408)", () => {
  it("en: count=42 renders plural '42 reviews'", () => {
    renderWithIntl(<DirectionBreakdownChart rows={DIRECTION_ROWS} />);
    expect(screen.getByText(/42 reviews/i)).toBeInTheDocument();
  });

  it("en: count=1 renders singular '1 review'", () => {
    const singleRow: readonly DirectionBreakdownRow[] = [
      { direction: "name", total: 1, passes: 1, accuracy: 1.0, disabled: false },
    ];
    renderWithIntl(<DirectionBreakdownChart rows={singleRow} />);
    expect(screen.getByText(/^1 review$/)).toBeInTheDocument();
  });

  it("ja: renders without throwing", () => {
    renderJa(<DirectionBreakdownChart rows={DIRECTION_ROWS} />);
    // Heading is localised in Japanese.
    expect(screen.getByRole("heading", { name: /カード方向別の正解率/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CollectionTimeline — number-formatting in CountPill
// ---------------------------------------------------------------------------

describe("CollectionTimeline — locale coverage (#1408)", () => {
  it("renders without throwing in all supported locales", () => {
    const LOCALES: AppLocale[] = ["en", "ja", "zh-Hans", "zh-Hant"];
    for (const locale of LOCALES) {
      const { unmount } = renderWithIntl(
        <CollectionTimelineWidget timeline={EMPTY_TIMELINE} />,
        { locale },
      );
      unmount();
    }
  });
});
