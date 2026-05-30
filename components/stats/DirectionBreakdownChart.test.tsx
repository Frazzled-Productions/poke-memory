/**
 * Smoke tests for DirectionBreakdownChart.
 *
 * Exercises the empty-state path and the chart path (including the
 * TooltipBody sub-component that uses `statValue`) so the class-name
 * refactor lines are instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom
 * cannot satisfy. The Tooltip mock invokes its content render prop with
 * synthetic payload so TooltipBody (and its `statValue` line) executes.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { DirectionBreakdownChart } from "@/components/stats/DirectionBreakdownChart";
import type { DirectionBreakdownRow } from "@/lib/stats/direction-breakdown";

// ---------------------------------------------------------------------------
// Recharts mock — lightweight stubs so the component can render in jsdom.
// The Tooltip mock fires its content prop so TooltipBody runs.
// ---------------------------------------------------------------------------

type ChartDatum = {
  label: string;
  accuracyPct: number;
  total: number;
  passes: number;
  hasData: boolean;
  disabled: boolean;
};

const MOCK_DATUM: ChartDatum = {
  label: "Name",
  accuracyPct: 85,
  total: 20,
  passes: 17,
  hasData: true,
  disabled: false,
};

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: ({
    content,
  }: {
    content: (props: {
      active: boolean;
      payload: { payload: ChartDatum }[];
    }) => React.ReactNode;
  }) => (
    <div data-testid="tooltip">
      {content({ active: true, payload: [{ payload: MOCK_DATUM }] })}
    </div>
  ),
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: () => <div data-testid="y-axis" />,
}));

const ROWS: readonly DirectionBreakdownRow[] = [
  { direction: "name",     total: 20, passes: 17, accuracy: 0.85, disabled: false },
  { direction: "reverse",  total: 10, passes: 7,  accuracy: 0.7,  disabled: false },
];

describe("DirectionBreakdownChart", () => {
  it("renders the Accuracy by card direction heading", () => {
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(
      screen.getByRole("heading", { name: /accuracy by card direction/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when all rows have zero reviews", () => {
    const emptyRows: DirectionBreakdownRow[] = [
      { direction: "name",    total: 0, passes: 0, accuracy: null, disabled: false },
      { direction: "reverse", total: 0, passes: 0, accuracy: null, disabled: false },
    ];
    renderWithIntl(<DirectionBreakdownChart rows={emptyRows} />);
    expect(
      screen.getByText(/no reviews recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders the bar chart when rows have data", () => {
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders the TooltipBody content (statValue line) via the mocked Tooltip", () => {
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    // TooltipBody renders "Accuracy: 85%" using the statValue class when hasData is true.
    expect(screen.getByText(/accuracy: 85%/i)).toBeInTheDocument();
  });

  it("renders the per-direction review count list", () => {
    renderWithIntl(<DirectionBreakdownChart rows={ROWS} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
