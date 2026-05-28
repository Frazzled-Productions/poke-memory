/**
 * Smoke tests for DifficultyHistogram.
 *
 * Exercises the empty-state path and the chart path (including the
 * TooltipBody sub-component that uses `statValue`) so the class-name
 * refactor lines are instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom
 * cannot satisfy. The Tooltip mock invokes its content render prop with
 * synthetic payload so TooltipBody (and its `statValue` line) executes.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DifficultyHistogram } from "@/components/stats/DifficultyHistogram";
import type { DifficultyBucket } from "@/lib/stats/difficulty-histogram";

// ---------------------------------------------------------------------------
// Recharts mock — lightweight stubs so the component can render in jsdom.
// The Tooltip mock fires its content prop so TooltipBody runs.
// ---------------------------------------------------------------------------

type ChartDatum = {
  label: string;
  count: number;
  lower: number;
  upper: number;
};

const MOCK_DATUM: ChartDatum = {
  label: "3-4",
  count: 7,
  lower: 3,
  upper: 4,
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
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: ({ className }: { className?: string }) => (
    <div data-testid="y-axis" className={className} />
  ),
}));

const BUCKETS: readonly DifficultyBucket[] = [
  { lower: 1, upper: 2, label: "1-2", count: 2  },
  { lower: 3, upper: 4, label: "3-4", count: 7  },
  { lower: 5, upper: 6, label: "5-6", count: 5  },
  { lower: 7, upper: 8, label: "7-8", count: 3  },
  { lower: 9, upper: 10, label: "9-10", count: 1 },
];

describe("DifficultyHistogram", () => {
  it("renders the Card difficulty spread heading", () => {
    render(<DifficultyHistogram buckets={BUCKETS} mean={4.2} />);
    expect(
      screen.getByRole("heading", { name: /card difficulty spread/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when all buckets are zero", () => {
    const zeroBuckets = BUCKETS.map((b) => ({ ...b, count: 0 }));
    render(<DifficultyHistogram buckets={zeroBuckets} mean={null} />);
    expect(
      screen.getByText(/no cards introduced yet/i),
    ).toBeInTheDocument();
  });

  it("renders the bar chart when buckets have data", () => {
    render(<DifficultyHistogram buckets={BUCKETS} mean={4.2} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("renders the TooltipBody content (statValue line) via the mocked Tooltip", () => {
    render(<DifficultyHistogram buckets={BUCKETS} mean={4.2} />);
    // The tooltip mock fires content with the MOCK_DATUM (count=7); TooltipBody
    // renders "7 cards" using the statValue class.
    expect(screen.getByText("7 cards")).toBeInTheDocument();
  });

  it("renders the mean difficulty value", () => {
    render(<DifficultyHistogram buckets={BUCKETS} mean={4.2} />);
    expect(screen.getByText("4.2")).toBeInTheDocument();
  });
});
