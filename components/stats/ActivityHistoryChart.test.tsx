/**
 * Smoke tests for ActivityHistoryChart.
 *
 * Exercises the empty-state path and the chart path (including the
 * ChartTooltip sub-component that uses `statValue`) so the class-name
 * refactor lines are instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom
 * cannot satisfy. The Tooltip mock invokes its content render prop with
 * synthetic payload so ChartTooltip (and its `statValue` lines) executes.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActivityHistoryChart } from "@/components/stats/ActivityHistoryChart";
import type { ActivityPoint } from "@/lib/stats/activity-history";

// ---------------------------------------------------------------------------
// Recharts mock — lightweight stubs so the component can render in jsdom.
// The Tooltip mock fires its content prop so ChartTooltip runs.
// ---------------------------------------------------------------------------

const MOCK_PAYLOAD: ActivityPoint = {
  date: "2026-05-01",
  reviews: 12,
  introduced: 3,
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
      payload: { payload: ActivityPoint }[];
    }) => React.ReactNode;
  }) => (
    <div data-testid="tooltip">
      {content({ active: true, payload: [{ payload: MOCK_PAYLOAD }] })}
    </div>
  ),
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: ({ className }: { className?: string }) => (
    <div data-testid="y-axis" className={className} />
  ),
}));

const SERIES: readonly ActivityPoint[] = [
  { date: "2026-05-01", reviews: 12, introduced: 3 },
  { date: "2026-05-02", reviews: 5,  introduced: 0 },
];

describe("ActivityHistoryChart", () => {
  it("renders the Daily activity heading", () => {
    render(<ActivityHistoryChart series={[]} />);
    expect(
      screen.getByRole("heading", { name: /daily activity/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when there is no activity", () => {
    render(<ActivityHistoryChart series={[]} />);
    expect(
      screen.getByText(/no activity recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders the bar chart when series has data", () => {
    render(<ActivityHistoryChart series={SERIES} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders the ChartTooltip content (statValue lines) via the mocked Tooltip", () => {
    render(<ActivityHistoryChart series={SERIES} />);
    // The tooltip mock fires content with active=true; ChartTooltip renders
    // "Reviews: 12" using the statValue class — verify the text is present.
    expect(screen.getByText(/reviews: 12/i)).toBeInTheDocument();
  });

  it("renders the legend with Reviews and New cards introduced labels", () => {
    render(<ActivityHistoryChart series={SERIES} />);
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("New cards introduced")).toBeInTheDocument();
  });
});
