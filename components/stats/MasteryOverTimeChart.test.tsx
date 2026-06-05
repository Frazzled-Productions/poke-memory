/**
 * Smoke tests for MasteryOverTimeChart.
 *
 * Exercises both the empty-state path (lines 127, 129) and the chart path
 * (lines 188, 197) so the `cardPanel`/`mutedText`/`chartTickText` class-name
 * refactor is instrumented by the coverage gate.
 *
 * Recharts is mocked to avoid the ResizeObserver dependency that jsdom cannot
 * satisfy - the mock renders lightweight stubs while still executing the
 * component's own JSX paths.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { MasteryOverTimeChart } from "@/components/stats/MasteryOverTimeChart";
import type { MasteryPoint } from "@/lib/stats/mastery-over-time";

// ---------------------------------------------------------------------------
// Recharts mock - lightweight stubs so the component can render in jsdom.
// ---------------------------------------------------------------------------

vi.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: () => null,
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: ({ className }: { className?: string }) => (
    <div data-testid="y-axis" className={className} />
  ),
}));

const POINT: MasteryPoint = { date: "2026-05-01", count: 10 };

describe("MasteryOverTimeChart", () => {
  it("renders the section heading", () => {
    renderWithIntl(
      <MasteryOverTimeChart series={[]} totalCards={100} />,
    );
    expect(
      screen.getByRole("heading", { level: 2 }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state paragraph when there is no data (lines 127, 129)", () => {
    renderWithIntl(
      <MasteryOverTimeChart series={[]} totalCards={100} />,
    );
    expect(
      screen.getByText(/no mastered species yet/i),
    ).toBeInTheDocument();
  });

  it("renders the chart when series has data (lines 188, 197 - XAxis/YAxis className)", () => {
    renderWithIntl(
      <MasteryOverTimeChart series={[POINT, { date: "2026-05-10", count: 20 }]} totalCards={100} />,
    );
    // Recharts mock renders the axes with the className prop from the component.
    const xAxis = screen.getByTestId("x-axis");
    const yAxis = screen.getByTestId("y-axis");
    // The component passes chartTickText ("text-zinc-400 dark:text-zinc-500")
    // to both axes - verify the prop reaches the DOM stub.
    expect(xAxis.className).toContain("text-zinc-400");
    expect(yAxis.className).toContain("text-zinc-400");
  });

  it("renders the AreaChart stub when series has multiple points", () => {
    renderWithIntl(
      <MasteryOverTimeChart series={[POINT, { date: "2026-05-10", count: 20 }]} totalCards={100} />,
    );
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });
});
