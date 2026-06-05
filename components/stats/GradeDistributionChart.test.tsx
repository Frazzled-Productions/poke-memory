/**
 * Smoke tests for GradeDistributionChart.
 *
 * Exercises the empty-state path and the chart path (including the
 * ChartTooltip sub-component that uses `statValue`) so the class-name
 * refactor lines are instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom
 * cannot satisfy. The Tooltip mock invokes its content render prop with
 * synthetic payload so ChartTooltip (and its `statValue` line) executes.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { GradeDistributionChart } from "@/components/stats/GradeDistributionChart";
import type { GradeDistribution, GradeTrendPoint } from "@/lib/stats/grade-distribution";

// ---------------------------------------------------------------------------
// Recharts mock - lightweight stubs so the component can render in jsdom.
// The Tooltip mock fires its content prop so ChartTooltip runs.
// ---------------------------------------------------------------------------

type TooltipPayload = {
  weekStart: string;
  again: number;
  hard: number;
  good: number;
  easy: number;
  total: number;
};

const MOCK_WEEK: TooltipPayload = {
  weekStart: "2026-05-18",
  again: 2,
  hard: 3,
  good: 10,
  easy: 5,
  total: 20,
};

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: ({
    content,
  }: {
    content: (props: {
      active: boolean;
      payload: { payload: TooltipPayload }[];
    }) => React.ReactNode;
  }) => (
    <div data-testid="tooltip">
      {content({ active: true, payload: [{ payload: MOCK_WEEK }] })}
    </div>
  ),
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: ({ className }: { className?: string }) => (
    <div data-testid="y-axis" className={className} />
  ),
}));

const DISTRIBUTION: GradeDistribution = {
  again: 5,
  hard: 10,
  good: 40,
  easy: 20,
  total: 75,
};

const TREND: readonly GradeTrendPoint[] = [
  { weekStart: "2026-05-18", again: 2, hard: 3, good: 10, easy: 5, total: 20 },
  { weekStart: "2026-05-11", again: 1, hard: 2, good: 8,  easy: 4, total: 15 },
];

describe("GradeDistributionChart", () => {
  it("renders the Grade distribution heading", () => {
    renderWithIntl(<GradeDistributionChart distribution={DISTRIBUTION} trend={TREND} />);
    expect(
      screen.getByRole("heading", { name: /grade distribution/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when distribution total is zero", () => {
    const empty: GradeDistribution = { again: 0, hard: 0, good: 0, easy: 0, total: 0 };
    renderWithIntl(<GradeDistributionChart distribution={empty} trend={[]} />);
    expect(
      screen.getByText(/no grades recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders the bar chart when trend has data", () => {
    renderWithIntl(<GradeDistributionChart distribution={DISTRIBUTION} trend={TREND} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders the ChartTooltip content (statValue line) via the mocked Tooltip", () => {
    renderWithIntl(<GradeDistributionChart distribution={DISTRIBUTION} trend={TREND} />);
    // ChartTooltip renders grade rows with statValue class - "Again: 2" should appear.
    expect(screen.getByText(/again: 2/i)).toBeInTheDocument();
  });

  it("renders the overall distribution bar when total is non-zero", () => {
    renderWithIntl(<GradeDistributionChart distribution={DISTRIBUTION} trend={TREND} />);
    // The OverallBar renders an img role with the grade mix aria-label.
    expect(
      screen.getByRole("img", { name: /all-time grade mix/i }),
    ).toBeInTheDocument();
  });
});
